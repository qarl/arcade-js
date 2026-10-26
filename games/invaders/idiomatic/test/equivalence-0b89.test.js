// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for finishAttractCycle (ROM 0x0b89), the never-returning attract teardown coroutine.
// FRAME MODEL: one frame = the idiomatic mid+vblank ISR bodies, run IDENTICALLY on both sides -- at each
// idiomatic `yield`, and on the oracle at each busy-wait loop BACK-EDGE (the jump that re-enters a spin top),
// regs saved/restored there as the RST push/pop does.
// BOUND: the oracle's tail into enterAttractCycle (0x18df) + EXTRA frames of the next cycle; the idiomatic
// run stops at the same frame count.
// CONTRACT: per-frame RAM minus STACK_SCRATCH, plus the IO log (every port write and INTE), plus the watchdog
// port-6 log (frame and value). On the toggle-0 path runAttractAnimTask's kicks differ from 0x0a80's in value
// and count, MEASURED and asserted exactly: inside each 0x0a85 spin the oracle kicks A (0x02, then the 0x00 it
// read from 0x20cb) and kicks once more on the frame it exits; the module kicks 0x02 and skips that last kick.
// Every other kick (all of them on the toggle-1 path) must match exactly.
// Every entry seats SP at 0x2400, so the oracle's pushes stay inside STACK_SCRATCH (asserted).
// SP: the module leaves SP untouched (a moved SP is a diff); the oracle, bounded inside 0x0a93's 0x0a9e spin,
// sits at entry-2 (MEASURED on every entry). No register live-out: it never returns.
// Run: node --test games/invaders/idiomatic/test/equivalence-0b89.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0b89 as oracle } from "../../translated/loc_0b89.js";
import { loc_0aea } from "../../translated/loc_0aea.js";
import { finishAttractCycle as idiomatic } from "../finishAttractCycle.js";
import { STACK_SCRATCH, SCREEN_MODE_TOGGLE, TASK_FLAGS } from "../names.js";
import { idiomaticMidNmi } from "../idiomaticMidNmi.js";
import { idiomaticVblankNmi } from "../idiomaticVblankNmi.js";
import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0b89;
const LANDMARK = 0x18df;
const EXTRA = 0x48;
const MAX_FRAMES = 4000;
const STACK_DEPTH = 0x10;
// spin top -> its back-edge jump PC: 0ad7 waitFrames, 0a93 paced typer, 0a80 anim task, 0b71/0b83 demo loops, 189e handshake
const EDGES = new Map([[0x0ada, 0x0ade], [0x0a9e, 0x0aa2], [0x0a85, 0x0a8b], [0x0b71, 0x0b7c], [0x0b83, 0x0b86], [0x18b8, 0x18bd], [0x18c0, 0x18c5]]);
const BOUND = Symbol("bound");
const ANIM_SPIN = 0x0a85; // 0x0a80's spin top: the oracle's `out 0x06` there runs with pc still at it
/** The module's expected kick log from the oracle's: each 0x0a85 spin run kicks 0x02 and drops its exit kick. */
function expectedKicks(wd) {
  const out = [];
  wd.forEach((k, i) => {
    if (!k.spin) out.push(`${k.f}=${k.v}`);
    else if (wd[i + 1] && wd[i + 1].spin) out.push(`${k.f}=2`);
  });
  return out;
}
const hx = (v) => "0x" + (v & 0xffff).toString(16);

function fresh(e, routines = buildRoutines()) {
  const m = new Machine(ROM, routines);
  m.regs.copyFrom(e.regs); m.mem.ram.set(e.mem.ram); m.io.loadStateFrom(e.io);
  m.pc = e.pc; m.pcKnown = true;
  m.nextInt1 = m.nextInt2 = m.nextBoundary = m.maxCycles = Infinity;
  return m;
}
function logIo(m, io) {
  const out = m.io.portOut.bind(m.io), inte = m.io.setInte.bind(m.io);
  io.wd = [];
  m.io.portOut = (p, v) => {
    if (p === 0x06) io.wd.push({ f: io.frame, v, spin: m.pc === ANIM_SPIN }); else io.push(`${io.frame}:${p}=${v}`);
    return out(p, v);
  };
  m.io.setInte = (on) => { io.push(`${io.frame}:inte=${!!on}`); return inte(on); };
}
function service(m) { idiomaticMidNmi(m); idiomaticVblankNmi(m); }
const inScratch = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

/** Oracle under the frame model; bound = landmark arrival + EXTRA. onStep may throw BOUND; hook = crafted poke after
 * each service, applied identically by runIdiomatic. */
function runOracle(e, { routines, onStep, hook, fn = oracle, mark = LANDMARK } = {}) {
  const m = fresh(e, routines), snaps = [], io = []; io.frame = 0;
  let limit = MAX_FRAMES, landmark = null, minSp = m.regs.sp;
  logIo(m, io);
  const snap = () => m.dumpState();
  const real = m.step.bind(m);
  m.step = (next, cyc) => {
    const from = m.pc;
    real(next, cyc);
    minSp = Math.min(minSp, m.regs.sp);
    if (onStep) onStep(m, next);
    if (next === mark && landmark === null && snaps.length > 0) { landmark = snaps.length; limit = landmark + EXTRA; }
    if (EDGES.get(next) !== from) return;
    snaps.push(snap()); io.frame = snaps.length;
    if (snaps.length >= limit) throw BOUND;
    const saved = new m.regs.constructor(); saved.copyFrom(m.regs);
    service(m); if (hook) hook(m);
    m.regs.copyFrom(saved);
  };
  let bounded = false, returned = false;
  try { fn(m); returned = true; snaps.push(snap()); } catch (x) { if (x !== BOUND) throw x; bounded = true; }
  return { m, snaps, io, landmark, minSp, bounded, returned };
}
function runIdiomatic(e, gen, frames, hook) {
  const m = fresh(e), snaps = [], io = []; io.frame = 0;
  logIo(m, io);
  const it = gen(m);
  let done = false;
  while (snaps.length < frames) {
    if (it.next().done) { done = true; snaps.push(m.dumpState()); break; }
    snaps.push(m.dumpState()); io.frame = snaps.length;
    if (snaps.length < frames) { service(m); if (hook) hook(m); }
  }
  return { m, snaps, io, done };
}
function firstDiff(o, c) {
  if (o.returned !== c.done) return { frame: -1, what: `oracle returned=${o.returned}, module done=${c.done}` };
  const skip = inScratch;
  if (o.snaps.length !== c.snaps.length) return { frame: Math.min(o.snaps.length, c.snaps.length), what: `frames ${o.snaps.length} vs ${c.snaps.length}` };
  for (let f = 0; f < o.snaps.length; f++) {
    const a = o.snaps[f], b = c.snaps[f];
    for (let i = 0; i < a.length; i++) {
      const addr = o.m.stateOffsetToAddr(i);
      if (a[i] !== b[i] && !skip(addr)) return { frame: f, addr, what: `${hx(addr)} oracle=${a[i]} module=${b[i]}` };
    }
  }
  const n = Math.max(o.io.length, c.io.length);
  for (let k = 0; k < n; k++) if (o.io[k] !== c.io[k]) return { frame: -1, what: `io[${k}] ${o.io[k]} vs ${c.io[k]}` };
  const want = expectedKicks(o.io.wd), got = c.io.wd.map((k) => `${k.f}=${k.v}`);
  for (let k = 0; k < Math.max(want.length, got.length); k++) if (want[k] !== got[k]) return { frame: -1, what: `watchdog[${k}] want ${want[k]} got ${got[k]}` };
  return null;
}
function compare(e, gen = idiomatic, opts = {}) {
  const o = runOracle(e, opts);
  assert.ok(o.returned || (o.bounded && o.landmark !== null), `oracle neither returned nor reached the landmark in ${MAX_FRAMES} frames`);
  assert.ok(o.minSp >= e.regs.sp - STACK_DEPTH, `oracle stack ${hx(o.minSp)} ran deeper than ${hx(STACK_DEPTH)}`);
  assert.ok(o.minSp >= STACK_SCRATCH.lo && e.regs.sp <= STACK_SCRATCH.hi, `oracle stack ${hx(o.minSp)}..${hx(e.regs.sp)} leaves STACK_SCRATCH`);
  assert.equal(o.m.regs.sp, (e.regs.sp - 2) & 0xffff, "oracle SP at the bound (inside 0x0a93, 0x0a9e spin) is entry-2");
  const c = runIdiomatic(e, gen, o.snaps.length, opts.hook);
  const moved = c.m.regs.sp !== e.regs.sp && { frame: -1, what: `idiomatic SP ${hx(e.regs.sp)} -> ${hx(c.m.regs.sp)}` };
  return { o, c, d: firstDiff(o, c) ?? (moved || null) };
}


// Entries: the first two real 0x0b89 dispatches of a cycle-driven boot (toggles 1 and 0), plus the 0x0b89 dispatch
// the oracle 0x0aea makes under this frame model from each real 0x0aea entry (toggles 1 and 0).
function capture() {
  const base = buildRoutines(), real = [], aea = [];
  const routines = new Map(base)
    .set(TARGET, (mm) => { if (real.length < 2) real.push(mm.clone()); return base.get(TARGET)(mm); })
    .set(0x0aea, (mm) => { if (aea.length < 2) aea.push(mm.clone()); return base.get(0x0aea)(mm); });
  new Machine(ROM, routines).runFrames(3400);
  const model = aea.map((e) => {
    let cap = null;
    runOracle(e, { fn: loc_0aea, onStep: (m, next) => { if (next === TARGET) { cap = m.clone(); throw BOUND; } } });
    return cap;
  });
  return [...real, ...model];
}
const ENTRIES = ROM_PRESENT ? capture() : [];
const withIn2 = (e, v) => { const x = e.clone(); x.io.in2 = v; return x; };

test("CAPTURE: real + modelled dispatches -- finishAttractCycle == oracle, every frame, back into the loop", () => {
  assert.equal(ENTRIES.length, 4, "expected four 0x0b89 entries");
  assert.deepEqual(ENTRIES.map((e) => e.mem.read8(SCREEN_MODE_TOGGLE)), [1, 0, 1, 0], "entries must cover both screen toggles");
  for (const e of ENTRIES) {
    const { o, c, d } = compare(e);
    assert.equal(d, null, d && `frame ${d.frame}: ${d.what}`);
    const spins = o.io.wd.filter((k) => k.spin).length;
    assert.ok(e.mem.read8(SCREEN_MODE_TOGGLE) === 0 ? spins > 1 : spins === 0, `0x0a85 kicks ${spins}: the spin carve-out must apply on toggle 0 only`);
    assert.equal(c.m.mem.read8(SCREEN_MODE_TOGGLE), e.mem.read8(SCREEN_MODE_TOGGLE) ^ 1, "the toggle did not flip");
    console.log(`  toggle=${e.mem.read8(SCREEN_MODE_TOGGLE)} sp=${hx(e.regs.sp)}: ${o.snaps.length} frames identical (rejoined at ${o.landmark})`);
  }
});

// Only IN2 bit 7 selects (`in 2; rlc; jc`): the sweep sets the other bits with bit 7 clear and set. Bit 2 (tilt)
// is swept on toggle 1 only: on toggle 0 the 0x0a80 anim never completes with it set, so no run reaches 0x18df.
test("CRAFTED: IN2 swept off and on bit 7 (second attract script skipped only on bit 7) on both toggles", () => {
  for (const e of ENTRIES.slice(1)) {
    const full = compare(e).o.landmark;
    for (const v of [0x00, 0x01, 0x08, 0x7b, 0x80, 0xfb, ...(e.mem.read8(SCREEN_MODE_TOGGLE) ? [0x04, 0x84, 0x7f, 0xff] : [])]) {
      const { d, o } = compare(withIn2(e, v));
      assert.equal(d, null, d && `in2=${hx(v)} frame ${d.frame}: ${d.what}`);
      assert.equal(o.landmark < full, (v & 0x80) !== 0, `in2=${hx(v)}: the skip arm must run exactly when bit 7 is set`);
    }
  }
});

test("LIVE-IN: different poisoned entry registers on each side change nothing (no register inputs)", () => {
  const e = ENTRIES[1], po = e.clone(), pc = e.clone();
  for (const r of ["a", "f", "b", "c", "d", "e", "h", "l"]) { po.regs[r] = 0x5a; pc.regs[r] = 0xa5; }
  const o = runOracle(po);
  assert.equal(firstDiff(o, runIdiomatic(pc, idiomatic, o.snaps.length)), null);
});

test("TEETH: broken twins are caught", () => {
  const twins = {
    "IN2 bit 7 misread": function* (m) {
      const inp = m.io.portIn.bind(m.io);
      m.io.portIn = (p) => (p === 0x02 ? inp(p) ^ 0x80 : inp(p));
      yield* idiomatic(m);
    },
    "TASK_FLAGS flipped at frame 300": function* (m) {
      let k = 0;
      const it = idiomatic(m);
      while (!it.next().done) { if (++k === 300) m.mem8[TASK_FLAGS] ^= 0x01; yield; }
    },
    "0x2400 (first cell above the masked STACK_SCRATCH) flipped at frame 300": function* (m) {
      let k = 0;
      const it = idiomatic(m);
      while (!it.next().done) { if (++k === 300) m.mem8[STACK_SCRATCH.hi] ^= 0xff; yield; }
    },
    "one extra frame": function* (m) { yield; yield* idiomatic(m); },
    "one extra watchdog kick at frame 300": function* (m) {
      let k = 0;
      const it = idiomatic(m);
      while (!it.next().done) { if (++k === 300) m.io.portOut(0x06, 0); yield; }
    },
    "SP moved by -2": function* (m) { m.regs.sp = (m.regs.sp - 2) & 0xffff; yield* idiomatic(m); },
    "extra port 3 write": function* (m) { m.io.portOut(0x03, 0x00); yield* idiomatic(m); },
    "anim spin kicks A=0 like the ROM": function* (m) {
      const out = m.io.portOut.bind(m.io);
      m.io.portOut = (p, v) => out(p, p === 0x06 && v === 2 ? 0 : v);
      yield* idiomatic(m);
    },
  };
  for (const [name, gen] of Object.entries(twins)) {
    assert.notEqual(compare(ENTRIES[1], gen).d, null, `twin "${name}" escaped the gate`);
  }
});

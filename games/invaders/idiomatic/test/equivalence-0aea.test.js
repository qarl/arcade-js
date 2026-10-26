// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for runAttractCycle (ROM 0x0aea), the never-returning attract setup + demo coroutine.
// FRAME MODEL: one frame = the idiomatic mid+vblank ISR bodies, run IDENTICALLY on both sides -- at each
// idiomatic `yield`, and on the oracle at each busy-wait loop BACK-EDGE (the jump that re-enters a spin top),
// regs saved/restored there as the RST push/pop does.
// BOUND: the oracle's fall into finishAttractCycle (0x0b89) + EXTRA frames of teardown; the idiomatic run
// stops at the same frame count.
// CONTRACT: per-frame RAM minus STACK_SCRATCH, plus the IO log (every port write but watchdog port 6, and INTE),
// plus per-frame watchdog kick COUNTS: equal, except oracle = module+1 on each frame 0x0a80 leaves its poll loop
// (its final `out 6` poll has no module twin) -- measured: toggle 1 equal, toggle 0 +1 on three frames.
// The kick VALUE is not compared: port 6 is a strobe, and the module writes updateFleetAndDrawCopyright's
// (often undefined) result where the ROM writes A.
// Every real entry seats SP at 0x2400, so the oracle's pushes stay inside STACK_SCRATCH (asserted).
// SP: the module leaves SP untouched (a moved SP is a diff); the oracle, bounded inside 0x0a93's 0x0a9e spin,
// sits at entry-6 (MEASURED on every entry). No register live-out: it never returns.
// Run: node --test games/invaders/idiomatic/test/equivalence-0aea.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0aea as oracle } from "../../translated/loc_0aea.js";
import { runAttractCycle as idiomatic } from "../runAttractCycle.js";
import { STACK_SCRATCH, SCREEN_MODE_TOGGLE, PLAYER1_SHIP_COUNT, TASK_FLAGS, loc_2015, INPUT_CODE_STAGE_FLAG, TAITO_COPYRIGHT_SCREEN_ADDR } from "../names.js";
import { idiomaticMidNmi } from "../idiomaticMidNmi.js";
import { idiomaticVblankNmi } from "../idiomaticVblankNmi.js";
import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0aea;
const LANDMARK = 0x0b89;
const EXTRA = 0x48;
const MAX_FRAMES = 4000;
const STACK_DEPTH = 0x10;
// spin top -> its back-edge jump PC: 0ad7 waitFrames, 0a93 paced typer, 0a80 anim task, 0b71/0b83 demo loops, 189e handshake
const EDGES = new Map([[0x0ada, 0x0ade], [0x0a9e, 0x0aa2], [0x0a85, 0x0a8b], [0x0b71, 0x0b7c], [0x0b83, 0x0b86], [0x18b8, 0x18bd], [0x18c0, 0x18c5]]);
const BOUND = Symbol("bound");
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
  io.kicks = new Map(); // watchdog port 6: frame -> kick count, compared apart from the log
  m.io.portOut = (p, v) => {
    if (p === 0x06) io.kicks.set(io.frame, (io.kicks.get(io.frame) ?? 0) + 1); else io.push(`${io.frame}:${p}=${v}`);
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
  const animExits = new Set(); // frames where 0x0a80 left its poll loop (its last poll's kick has no module twin)
  logIo(m, io);
  const snap = () => m.dumpState();
  const real = m.step.bind(m);
  m.step = (next, cyc) => {
    const from = m.pc;
    real(next, cyc);
    minSp = Math.min(minSp, m.regs.sp);
    if (onStep) onStep(m, next);
    if (next === 0x0a8e) animExits.add(io.frame);
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
  return { m, snaps, io, landmark, minSp, bounded, returned, animExits };
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
  // Watchdog, measured: per frame the oracle kicks exactly the module's count, +1 on a frame where 0x0a80 left its
  // poll loop (its final poll kicks; the module's exit test does not).
  for (const k of new Set([...o.io.kicks.keys(), ...c.io.kicks.keys()])) {
    const ok = o.io.kicks.get(k) ?? 0, ck = c.io.kicks.get(k) ?? 0;
    if (ok - ck !== (o.animExits.has(k) ? 1 : 0)) return { frame: k, what: `watchdog kicks oracle=${ok} module=${ck}` };
  }
  return null;
}
function compare(e, gen = idiomatic, opts = {}) {
  const o = runOracle(e, opts);
  assert.ok(o.returned || (o.bounded && o.landmark !== null), `oracle neither returned nor reached the landmark in ${MAX_FRAMES} frames`);
  assert.ok(o.minSp >= e.regs.sp - STACK_DEPTH, `oracle stack ${hx(o.minSp)} ran deeper than ${hx(STACK_DEPTH)}`);
  assert.ok(o.minSp >= STACK_SCRATCH.lo && e.regs.sp <= STACK_SCRATCH.hi, `oracle stack ${hx(o.minSp)}..${hx(e.regs.sp)} leaves STACK_SCRATCH`);
  assert.equal(o.m.regs.sp, (e.regs.sp - 6) & 0xffff, "oracle SP at the bound (inside 0x0a93, 0x0a9e spin) is entry-6");
  const c = runIdiomatic(e, gen, o.snaps.length, opts.hook);
  const moved = c.m.regs.sp !== e.regs.sp && { frame: -1, what: `idiomatic SP ${hx(e.regs.sp)} -> ${hx(c.m.regs.sp)}` };
  return { o, c, d: firstDiff(o, c) ?? (moved || null) };
}


// Real dispatches of 0x0aea in a cycle-driven boot: cold start (toggle 1) and the attract loop-back (toggle 0).
function capture() {
  const base = buildRoutines(), caps = [];
  const routines = new Map(base).set(TARGET, (mm) => { if (caps.length < 2) caps.push(mm.clone()); return base.get(TARGET)(mm); });
  new Machine(ROM, routines).runFrames(1900);
  return caps;
}
const ENTRIES = ROM_PRESENT ? capture() : [];
const withShips = (e, v) => { const x = e.clone(); x.mem.write8(PLAYER1_SHIP_COUNT, v); return x; };

test("CAPTURE: both real dispatches -- runAttractCycle == oracle, every frame", () => {
  assert.equal(ENTRIES.length, 2, "expected two real 0x0aea dispatches");
  assert.deepEqual(ENTRIES.map((e) => e.mem.read8(SCREEN_MODE_TOGGLE)), [1, 0], "entries must cover both screen toggles");
  for (const e of ENTRIES) {
    const { o, c, d } = compare(e);
    assert.equal(d, null, d && `frame ${d.frame}: ${d.what}`);
    assert.equal(o.animExits.size, e.mem.read8(SCREEN_MODE_TOGGLE) ? 0 : 3, "the 0x0a80 watchdog allowance is not the measured one");
    assert.equal(c.m.mem.read8(TASK_FLAGS), 0x00, "the teardown never ran");
    console.log(`  toggle=${e.mem.read8(SCREEN_MODE_TOGGLE)} ships=${e.mem.read8(PLAYER1_SHIP_COUNT)} sp=${hx(e.regs.sp)}: ${o.snaps.length} frames identical (demo ended at ${o.landmark})`);
  }
});

// Swept across the 0/1 boundary and the high bits, so a `< n` or masked rewrite of the zero test is heard.
test("CRAFTED: the ship-seed arm swept on each real entry (ships 0 seeds from the DIP, nonzero skips)", () => {
  for (const e of ENTRIES) for (const v of [0x00, 0x01, 0x02, 0x03, 0x80, 0xff]) {
    const { d, c } = compare(withShips(e, v));
    assert.equal(d, null, d && `ships=${v} frame ${d.frame}: ${d.what}`);
    if (v === 0) assert.notEqual(c.m.mem.read8(PLAYER1_SHIP_COUNT), 0, "the seed arm did not run");
  }
});

// The exit iteration still runs updateFleetAndDrawCopyright after the trigger drops; in the real demo that call is a
// no-op there, so make it heard: on the first demo frame drop the trigger, arm the copyright easter-egg input
// (stage flag set, IN1 & 0x76 == 0x34) and smudge the copyright cell it redraws -- identically on both sides.
test("CRAFTED: trigger dropped on the first demo frame with the copyright redraw armed", () => {
  const hook = (m) => {
    if (m.mem8[TASK_FLAGS] !== 0x01 || m.poked) return;
    m.poked = true;
    m.mem8[loc_2015] = 0x00; m.mem8[INPUT_CODE_STAGE_FLAG] = 0x01; m.io.in1 = 0x3d;
    m.mem8[TAITO_COPYRIGHT_SCREEN_ADDR] ^= 0xff;
  };
  for (const e of ENTRIES) {
    const { d, o } = compare(e, idiomatic, { hook });
    assert.equal(d, null, d && `frame ${d.frame}: ${d.what}`);
    assert.ok(o.landmark < compare(e).o.landmark, "the crafted trigger did not end the demo early");
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
    "port 3 not silenced": function* (m) {
      const out = m.io.portOut;
      m.io.portOut = (p, v) => (p === 0x03 ? undefined : out(p, v));
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
  };
  for (const [name, gen] of Object.entries(twins)) {
    assert.notEqual(compare(ENTRIES[1], gen).d, null, `twin "${name}" escaped the gate`);
  }
});

// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for enterAttractCycle (ROM 0x18df), the never-returning attract-loop join coroutine.
// FRAME MODEL: one frame = the idiomatic mid+vblank ISR bodies, run IDENTICALLY on both sides -- at each
// idiomatic `yield`, and on the oracle at each busy-wait loop BACK-EDGE (the jump that re-enters a spin top),
// regs saved/restored there as the RST push/pop does.
// BOUND: the oracle's next arrival at 0x18df (the loop closes) + EXTRA frames into the next cycle; the
// idiomatic run stops at the same frame count.
// CONTRACT: per-frame RAM, each cell the oracle's push16/xthl had written by that frame compared on its data view
// (any module stack write must fall inside them); the IO log (every port write but watchdog port 6, and INTE);
// per-frame watchdog kicks, equal except oracle = module+1 on each frame 0x0a80 leaves its poll loop; module SP
// untouched, oracle SP within SP_WINDOW below the entry SP.
// No register live-out: it never returns.
// Run: node --test games/invaders/idiomatic/test/equivalence-18df.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_18df as oracle } from "../../translated/loc_18df.js";
import { enterAttractCycle as idiomatic } from "../enterAttractCycle.js";
import { runAttractCycle } from "../runAttractCycle.js";
import { SCREEN_MODE_TOGGLE, loc_20cf } from "../names.js";
import { idiomaticMidNmi } from "../idiomaticMidNmi.js";
import { idiomaticVblankNmi } from "../idiomaticVblankNmi.js";
import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x18df;
const LANDMARK = 0x18df;
const EXTRA = 0x48;
const MAX_FRAMES = 4000;
const SP_WINDOW = 0x10;
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
// Stack shadow: first = cell -> frame of its first push16/xthl write; dv = cell -> its DATA VIEW (the value before
// that first stack write, then each later NON-stack store). From that frame on the cell is compared on its view.
function shadowStack(m, io) {
  const first = new Map(), dv = new Map(), mem = m.mem;
  const push = m.push16.bind(m), w16 = mem.write16.bind(mem), w8 = mem.write8.bind(mem);
  let inStack = false;
  const mark = (a) => {
    for (const x of [a, (a + 1) & 0xffff]) if (!first.has(x)) { first.set(x, io.frame); dv.set(x, mem.ram[x - 0x2000]); }
  };
  const stackWrite = (a, fn) => { mark(a); inStack = true; try { return fn(); } finally { inStack = false; } };
  m.push16 = (v) => stackWrite((m.regs.sp - 2) & 0xffff, () => push(v));
  mem.write16 = (a, v) => (a === m.regs.sp ? stackWrite(a, () => w16(a, v)) : w16(a, v));
  mem.write8 = (a, v) => { if (!inStack && dv.has(a)) dv.set(a, v & 0xff); return w8(a, v); };
  return { first, dv, dvs: [] };
}
const snap = (m, snaps, stack) => { snaps.push(m.dumpState()); stack.dvs.push(new Map(stack.dv)); };
function service(m) { idiomaticMidNmi(m); idiomaticVblankNmi(m); }

/** Oracle under the frame model; bound = landmark arrival + EXTRA. onStep may throw BOUND; hook = crafted poke after
 * each service, applied identically by runIdiomatic. */
function runOracle(e, { routines, onStep, hook, fn = oracle, mark = LANDMARK } = {}) {
  const m = fresh(e, routines), snaps = [], io = []; io.frame = 0;
  let limit = MAX_FRAMES, landmark = null, minSp = m.regs.sp;
  const animExits = new Set(); // frames where 0x0a80 left its poll loop (its last poll's kick has no module twin)
  logIo(m, io);
  const stack = shadowStack(m, io);
  const real = m.step.bind(m);
  m.step = (next, cyc) => {
    const from = m.pc;
    real(next, cyc);
    minSp = Math.min(minSp, m.regs.sp);
    if (onStep) onStep(m, next);
    if (next === 0x0a8e) animExits.add(io.frame);
    if (next === mark && landmark === null && snaps.length > 0) { landmark = snaps.length; limit = landmark + EXTRA; }
    if (EDGES.get(next) !== from) return;
    snap(m, snaps, stack); io.frame = snaps.length;
    if (snaps.length >= limit) throw BOUND;
    const saved = new m.regs.constructor(); saved.copyFrom(m.regs);
    service(m); if (hook) hook(m);
    m.regs.copyFrom(saved);
  };
  let bounded = false, returned = false;
  try { fn(m); returned = true; snap(m, snaps, stack); } catch (x) { if (x !== BOUND) throw x; bounded = true; }
  return { m, snaps, io, stack, landmark, minSp, bounded, returned, animExits };
}
function runIdiomatic(e, gen, frames, hook) {
  const m = fresh(e), snaps = [], io = []; io.frame = 0;
  logIo(m, io);
  const stack = shadowStack(m, io);
  const it = gen(m);
  let done = false;
  while (snaps.length < frames) {
    if (it.next().done) { done = true; snap(m, snaps, stack); break; }
    snap(m, snaps, stack); io.frame = snaps.length;
    if (snaps.length < frames) { service(m); if (hook) hook(m); }
  }
  return { m, snaps, io, stack, done };
}
function firstDiff(o, c) {
  if (o.returned !== c.done) return { frame: -1, what: `oracle returned=${o.returned}, module done=${c.done}` };
  for (const [a, f] of c.stack.first) if (!(o.stack.first.get(a) <= f)) return { frame: f, addr: a, what: `module stack write ${hx(a)} outside the oracle's` };
  let f = 0;
  const onView = (a) => o.stack.first.get(a) <= f;
  const view = (r, a, raw) => (r.stack.dvs[f].has(a) ? r.stack.dvs[f].get(a) : raw);
  if (o.snaps.length !== c.snaps.length) return { frame: Math.min(o.snaps.length, c.snaps.length), what: `frames ${o.snaps.length} vs ${c.snaps.length}` };
  for (; f < o.snaps.length; f++) {
    const a = o.snaps[f], b = c.snaps[f];
    for (let i = 0; i < a.length; i++) {
      const addr = o.m.stateOffsetToAddr(i);
      const [x, y] = onView(addr) ? [view(o, addr, a[i]), view(c, addr, b[i])] : [a[i], b[i]];
      if (x !== y) return { frame: f, addr, what: `${hx(addr)} oracle=${x} module=${y}` };
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
  assert.ok(o.minSp >= e.regs.sp - SP_WINDOW, `oracle stack ${hx(o.minSp)} ran more than SP_WINDOW below the entry SP`);
  const c = runIdiomatic(e, gen, o.snaps.length, opts.hook);
  assert.equal(c.m.regs.sp, e.regs.sp, "module SP untouched");
  return { o, c, d: firstDiff(o, c) };
}


// Real dispatches of 0x18df in a cycle-driven boot: cold start (toggle 1) and the finishAttractCycle loop-back (toggle 0).
function capture() {
  const base = buildRoutines(), caps = [];
  const routines = new Map(base).set(TARGET, (mm) => { if (caps.length < 2) caps.push(mm.clone()); return base.get(TARGET)(mm); });
  new Machine(ROM, routines).runFrames(1900);
  return caps;
}
const ENTRIES = ROM_PRESENT ? capture() : [];

test("CAPTURE: both real dispatches -- enterAttractCycle == oracle, every frame, through one full cycle", () => {
  assert.equal(ENTRIES.length, 2, "expected two real 0x18df dispatches");
  assert.deepEqual(ENTRIES.map((e) => e.mem.read8(SCREEN_MODE_TOGGLE)), [1, 0], "entries must cover both screen toggles");
  let exits = 0;
  for (const e of ENTRIES) {
    const { o, c, d } = compare(e);
    exits += o.animExits.size;
    assert.equal(d, null, d && `frame ${d.frame}: ${d.what}`);
    assert.equal(c.snaps[0][loc_20cf - 0x2000], 0x08, "loc_20cf not seeded");
    assert.notEqual(c.m.mem.read8(SCREEN_MODE_TOGGLE), e.mem.read8(SCREEN_MODE_TOGGLE), "the cycle never reached the teardown flip");
    console.log(`  toggle=${e.mem.read8(SCREEN_MODE_TOGGLE)}: ${o.snaps.length} frames identical (loop closed at ${o.landmark})`);
  }
  assert.ok(exits > 0, "no entry exercised the 0x0a80 watchdog allowance");
});

test("LIVE-IN: different poisoned entry registers on each side change nothing (no register inputs)", () => {
  const e = ENTRIES[0], po = e.clone(), pc = e.clone();
  for (const r of ["a", "f", "b", "c", "d", "e", "h", "l"]) { po.regs[r] = 0x5a; pc.regs[r] = 0xa5; }
  const o = runOracle(po);
  assert.equal(firstDiff(o, runIdiomatic(pc, idiomatic, o.snaps.length)), null);
});

test("TEETH: broken twins are caught", () => {
  const twins = {
    "wrong seed 0x09": function* (m) { m.mem8[loc_20cf] = 0x09; yield* runAttractCycle(m); },
    "seed dropped": function* (m) { yield* runAttractCycle(m); },
    "one extra frame": function* (m) { m.mem8[loc_20cf] = 0x08; yield; yield* runAttractCycle(m); },
  };
  for (const [name, gen] of Object.entries(twins)) {
    const ent = ENTRIES[0].clone();
    ent.mem.write8(loc_20cf, 0x00); // so a dropped seed is visible
    assert.notEqual(compare(ent, gen).d, null, `twin "${name}" escaped the gate`);
  }  // A plain store into a cell the oracle's stack writes must show on its data view.
  const plant = (addr, at) => function* (m) {
    let n = 0;
    for (const it = idiomatic(m); ;) { if (it.next().done) return; if (++n === at) m.mem8[addr] ^= 0xa5; yield; }
  };
  for (const e of ENTRIES) {
    const sp = e.regs.sp, first = runOracle(e).stack.first;
    const top = Math.min(...[...first.keys()].filter((a) => a >= sp - SP_WINDOW && a < sp));
    for (const a of [sp - 2, sp - 6, top]) {
      assert.ok(first.has(a), `${hx(a)} is not an oracle stack cell`);
      const d = compare(e, plant(a, first.get(a) + 6)).d;
      assert.notEqual(d, null, `planted store ${hx(a)} at sp=${hx(sp)} escaped the gate`);
    }
  }
});

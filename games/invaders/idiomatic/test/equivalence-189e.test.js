// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for runHandshakedAttractAnim (ROM 0x189e), the ISR-handshaked attract reveal coroutine.
// FRAME MODEL: one frame = the idiomatic mid+vblank ISR bodies, run IDENTICALLY on both sides -- at each
// idiomatic `yield`, and on the oracle at each busy-wait loop BACK-EDGE (the jump that re-enters a spin top),
// regs saved/restored there as the RST push/pop does.
// BOUND: it returns (oracle: tail 0x0ab6 -> 0x0ad7 ret), so both sides run to completion; the frame count,
// every frame and the final state must agree.
// CONTRACT: per-frame RAM minus STACK_SCRATCH, plus the IO log (every port write including watchdog port 6,
// and INTE).
// An entry SP seated in the framebuffer makes the oracle push return words into VRAM; each cell push16
// dirtied shows, in the oracle snapshot, its last NON-stack write (or entry value), so it is compared, not masked.
// SP: the module leaves SP untouched (a moved SP is a diff); the oracle's ret leaves it at entry+2.
// LIVE-OUT: memory only, MEASURED: the sole caller 0x0bd7 (finishAttractCycle) runs on unchanged with every
// value register poisoned at the return (and a poison at 0x1856's return, whose DE/HL are read, is heard).
// Run: node --test games/invaders/idiomatic/test/equivalence-189e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_189e as oracle } from "../../translated/loc_189e.js";
import { loc_0b89 } from "../../translated/loc_0b89.js";
import { loc_1856 } from "../../translated/loc_1856.js";
import { loc_0aea } from "../../translated/loc_0aea.js";
import { runHandshakedAttractAnim as idiomatic } from "../runHandshakedAttractAnim.js";
import { blockCopy } from "../blockCopy.js";
import { drawSprite8x8 } from "../drawSprite8x8.js";
import { waitLongDelay } from "../waitLongDelay.js";
import { STACK_SCRATCH, SCREEN_MODE_TOGGLE, TASK_FLAGS, ATTRACT_ANIM_ACK, ATTRACT_OBJECT_TABLE, ATTRACT_ANIM_OBJ_TEMPLATE, ALIEN_SHOT_STEP, loc_2080, loc_3311 } from "../names.js";
import { idiomaticMidNmi } from "../idiomaticMidNmi.js";
import { idiomaticVblankNmi } from "../idiomaticVblankNmi.js";
import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x189e;
const LANDMARK = null;
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
  m.io.portOut = (p, v) => { io.push(`${io.frame}:${p}=${v}`); return out(p, v); };
  m.io.setInte = (on) => { io.push(`${io.frame}:inte=${!!on}`); return inte(on); };
}
function service(m) { idiomaticMidNmi(m); idiomaticVblankNmi(m); }
const ramAddr = (a) => { a &= 0x7fff; if (a >= 0x6000) a -= 0x4000; return a >= 0x2000 && a < 0x4000 ? a : -1; };
const inScratch = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
/** Oracle-side push16 shadow: cell -> the oracle's last non-stack value, for every cell outside STACK_SCRATCH
 * that a push16 wrote (the ISR bodies and hooks write through write8 too, so they update it). */
function shadowStackWrites(m) {
  const shadow = new Map(), w8 = m.mem.write8.bind(m.mem), push = m.push16.bind(m);
  let pushing = false;
  m.mem.write8 = (addr, v, bus) => {
    const a = ramAddr(addr);
    if (a >= 0 && !inScratch(a)) {
      if (pushing) { if (!shadow.has(a)) shadow.set(a, m.mem.read8(a)); } else if (shadow.has(a)) shadow.set(a, v & 0xff);
    }
    return w8(addr, v, bus);
  };
  m.push16 = (v) => { pushing = true; try { push(v); } finally { pushing = false; } };
  return shadow;
}

/** Oracle under the frame model; bound = landmark arrival + EXTRA. onStep may throw BOUND; hook = crafted poke after
 * each service, applied identically by runIdiomatic. */
function runOracle(e, { routines, onStep, hook, fn = oracle, mark = LANDMARK } = {}) {
  const m = fresh(e, routines), snaps = [], io = []; io.frame = 0;
  let limit = MAX_FRAMES, landmark = null, minSp = m.regs.sp;
  logIo(m, io);
  const shadow = shadowStackWrites(m);
  const snap = () => { const s = m.dumpState(); for (const [a, v] of shadow) s[a - 0x2000] = v; return s; };
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
  return { m, snaps, io, landmark, minSp, bounded, returned, shadow };
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
  return null;
}
function compare(e, gen = idiomatic, opts = {}) {
  const o = runOracle(e, opts);
  assert.ok(o.returned || (o.bounded && o.landmark !== null), `oracle neither returned nor reached the landmark in ${MAX_FRAMES} frames`);
  assert.ok(o.minSp >= e.regs.sp - STACK_DEPTH, `oracle stack ${hx(o.minSp)} ran deeper than ${hx(STACK_DEPTH)}`);
  for (const a of o.shadow.keys()) assert.ok(a >= o.minSp && a < e.regs.sp, `shadowed ${hx(a)} lies outside the stack span`);
  assert.equal(o.m.regs.sp, (e.regs.sp + 2) & 0xffff, "oracle SP popped by its ret");
  const c = runIdiomatic(e, gen, o.snaps.length, opts.hook);
  const moved = c.m.regs.sp !== e.regs.sp && { frame: -1, what: `idiomatic SP ${hx(e.regs.sp)} -> ${hx(c.m.regs.sp)}` };
  return { o, c, d: firstDiff(o, c) ?? (moved || null) };
}


// No cycle-driven boot dispatches 0x189e (it warm-restarts before its toggle-0 teardown), so the entry is the
// dispatch the oracle 0x0aea makes under this frame model from its real toggle-0 entry; the 0x0b89 entry on
// the way is kept for the live-out arm.
function capture() {
  const base = buildRoutines(), aea = [];
  const routines = new Map(base).set(0x0aea, (mm) => { if (aea.length < 2) aea.push(mm.clone()); return base.get(0x0aea)(mm); });
  new Machine(ROM, routines).runFrames(1300);
  let at189e = null, at0b89 = null;
  runOracle(aea[1], { fn: loc_0aea, onStep: (m, next) => {
    if (next === 0x0b89 && !at0b89) at0b89 = m.clone();
    if (next === TARGET) { at189e = m.clone(); throw BOUND; }
  } });
  return { at189e, at0b89 };
}
const { at189e: ENTRY, at0b89: CALLER } = ROM_PRESENT ? capture() : {};
// The sole caller clears TASK_FLAGS first; a nonzero entry value makes a read-modify-write of it heard. Likewise
// loc_2080 (the 0x0072 ISR latch, measured 1 or 2 at real 0x0b89 entries) at 0x01 makes an |= of its seed heard.
const dirtyTaskFlags = () => { const x = ENTRY.clone(); x.mem.write8(TASK_FLAGS, 0x03); return x; };
const dirtyTable = () => { const x = ENTRY.clone(); for (let i = 0; i < 0x10; i++) x.mem.write8(ATTRACT_OBJECT_TABLE + i, x.mem.read8(ATTRACT_OBJECT_TABLE + i) ^ 0xff); return x; };
const poisonAfter = (addr, fn) => new Map(buildRoutines()).set(addr, (mm) => {
  const r = fn(mm);
  for (const k of ["a", "f", "b", "c", "d", "e", "h", "l"]) mm.regs[k] ^= 0xff;
  return r;
});

test("CAPTURE: the toggle-0 teardown dispatch -- runHandshakedAttractAnim == oracle, every frame, to its return", () => {
  assert.ok(ENTRY && ENTRY.mem.read8(SCREEN_MODE_TOGGLE) === 0, "no toggle-0 0x189e dispatch captured");
  const { o, c, d } = compare(ENTRY);
  assert.equal(d, null, d && `frame ${d.frame}: ${d.what}`);
  assert.ok(o.returned && o.snaps.length > 0x80, "the oracle did not run the handshake + long settle");
  assert.equal(c.m.mem.read8(TASK_FLAGS), 0x04, "the anim task was not armed");
  console.log(`  sp=${hx(ENTRY.regs.sp)}: ${o.snaps.length - 1} frames + final state identical (${o.shadow.size} VRAM cells push-shadowed)`);
});

// The entry blockCopy overwrites the ack byte (0x2055 = table+5), so craft it AFTER each service instead.
test("CRAFTED: a dirtied object table, TASK_FLAGS 0x03 and loc_2080 0x01 at entry, and ack bit1 forced on after every serviced frame", () => {
  const latch1 = () => { const x = ENTRY.clone(); x.mem.write8(loc_2080, 0x01); return x; };
  for (const [name, e, hook] of [["dirty table", dirtyTable(), undefined], ["task flags 0x03", dirtyTaskFlags(), undefined], ["loc_2080 0x01", latch1(), undefined], ["ack bit1", ENTRY, (m) => { m.mem8[ATTRACT_ANIM_ACK] |= 0x02; }]]) {
    const { d, o } = compare(e, idiomatic, { hook });
    assert.equal(d, null, d && `${name} frame ${d.frame}: ${d.what}`);
    assert.ok(o.returned, `${name}: oracle did not return`);
  }
});

test("LIVE-OUT: poisoning every value register at 0x189e's return is unheard by its caller 0x0b89", () => {
  assert.ok(CALLER && CALLER.mem.read8(SCREEN_MODE_TOGGLE) === 0, "no toggle-0 0x0b89 entry");
  const run = (routines) => runOracle(CALLER, { fn: loc_0b89, mark: 0x18df, routines });
  const plain = run(buildRoutines());
  assert.ok(plain.landmark !== null, "the caller never rejoined 0x18df");
  const asIdio = (o) => ({ ...o, returned: false, done: false });
  const heard = (o) => firstDiff(asIdio(plain), asIdio(o));
  assert.equal(heard(run(poisonAfter(TARGET, oracle))), null, "a register 0x189e leaves IS read back");
  assert.notEqual(heard(run(poisonAfter(0x1856, loc_1856))), null, "positive control: a read-back poison went unheard");
});

test("TEETH: broken twins are caught", () => {
  const twin = (task, waitClear, sprite) => function* (m) {
    blockCopy(m, ATTRACT_ANIM_OBJ_TEMPLATE, ATTRACT_OBJECT_TABLE, 0x10);
    m.mem8[loc_2080] = 0x02; m.mem8[ALIEN_SHOT_STEP] = 0xff; m.mem8[TASK_FLAGS] = task;
    while ((m.mem8[ATTRACT_ANIM_ACK] & 0x01) === 0) yield;
    if (waitClear) while ((m.mem8[ATTRACT_ANIM_ACK] & 0x01) !== 0) yield;
    drawSprite8x8(m, sprite, loc_3311);
    yield* waitLongDelay(m);
  };
  assert.equal(compare(ENTRY, twin(0x04, true, 0x26)).d, null, "the faithful twin must pass");
  const poke2730 = function* (m) { let k = 0; const it = idiomatic(m); while (!it.next().done) { if (++k === 100) m.mem8[0x2730] ^= 0xff; yield; } };
  const kick = function* (m) { m.io.portOut(0x06, 0x26); yield* idiomatic(m); };
  const sp2 = function* (m) { m.regs.sp = (m.regs.sp - 2) & 0xffff; yield* idiomatic(m); };
  const port3 = function* (m) { m.io.portOut(0x03, 0x00); yield* idiomatic(m); };
  for (const [name, gen] of [["extra watchdog kick", kick], ["SP moved by -2", sp2], ["extra port 3 write", port3], ["task 0x02", twin(0x02, true, 0x26)], ["no clear wait", twin(0x04, false, 0x26)], ["sprite 0x27", twin(0x04, true, 0x27)], ["VRAM 0x2730 (in the entry SP's push span) flipped at frame 100", poke2730]]) {
    assert.notEqual(compare(ENTRY, gen).d, null, `twin "${name}" escaped the gate`);
  }
});

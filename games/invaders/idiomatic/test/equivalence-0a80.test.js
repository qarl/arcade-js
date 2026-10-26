// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for runAttractAnimTask (ROM 0x0a80, generator): TASK_FLAGS=2, wait for the ISR to raise
// ANIM_DONE_FLAG (0x20cb), clear TASK_FLAGS. FRAME MODEL (identical hook on both sides): a poll of 0x20cb after the
// first fires the translated RST1+RST2 pair (m.fireNmi) once, so the REAL ISR task dispatch (0x0abf) runs the
// animation stepper off the TASK_FLAGS this routine wrote. The idiomatic side must yield exactly once before each
// tick. A tick cap throws BOUND. Contract: RAM, the cells the oracle's push16/xthl wrote in the 0x10 bytes below
// the entry SP compared on their data view (the idiomatic side's own stack writes must fall inside the oracle's),
// the frame count, and the port/INTE log (port 6 excepted); idiomatic SP untouched, oracle SP = entry+2 (its ret). Watchdog (port 6): exactly frames+1 kicks on the oracle (one per poll), frames on the module.
// LIVE-OUT: none -- A=0/Z are overwritten before a read at every return site (0b27 lxi d->0ae2, 0b30/0b3c -> 0ab1, 0bd7 -> 189e lxi h/lxi d/mvi b/mvi a).
// Run: node --test games/invaders/idiomatic/test/equivalence-0a80.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a80 as oracle } from "../../translated/loc_0a80.js";
import { runAttractAnimTask } from "../runAttractAnimTask.js";
import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { ANIM_DONE_FLAG, TASK_FLAGS } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0a80;
const CELL = ANIM_DONE_FLAG;
const CAP = 0x400;
const BOUND = Symbol("bound");
const ORACLE_ROUTINES = buildRoutines(); // the frame tick runs the translated ISRs, never the idiomatic ones
const hx = (v) => "0x" + (v & 0xffff).toString(16);

function capture(K, frames) {
  const caps = [], keys = new Set();
  const hook = new Map([[TARGET, (mm) => {
    const key = `${mm.regs.sp}:${mm.mem.read16(mm.regs.sp)}:${mm.mem.read16(0x20c2)}`;
    if (caps.length < K && !keys.has(key)) { keys.add(key); caps.push(mm.clone()); }
    return oracle(mm);
  }]]);
  new Machine(ROM, { overrides: hook }).runFrames(frames);
  return caps;
}
const CAPS = ROM_PRESENT ? capture(6, 2700) : []; // the reveals dispatch ~frames 2432, 2528, 2695

function prep(cap) {
  const m = cap.clone();
  m.io.setInte(false);
  m.routines = ORACLE_ROUTINES; m.idiomaticVblankNmi = m.idiomaticMidNmi = undefined;
  m.nextInt1 = m.nextInt2 = m.nextBoundary = m.maxCycles = Infinity;
  return m;
}

// Stack shadow: cell -> its DATA VIEW, for every cell a push16 (call, RST, push) or an xthl writes: the value before
// the first stack write there, then each later NON-stack store. Excluded cells are compared on this view.
function shadowStack(m) {
  const dv = new Map(), mem = m.mem, push = m.push16.bind(m), w16 = mem.write16.bind(mem), w8 = mem.write8.bind(mem);
  let inStack = false;
  const mark = (a) => { for (const x of [a, (a + 1) & 0xffff]) if (!dv.has(x)) dv.set(x, mem.ram[x - 0x2000]); };
  const stackWrite = (a, fn) => { mark(a); inStack = true; try { return fn(); } finally { inStack = false; } };
  m.push16 = (v) => stackWrite((m.regs.sp - 2) & 0xffff, () => push(v));
  mem.write16 = (a, v) => (a === m.regs.sp ? stackWrite(a, () => w16(a, v)) : w16(a, v));
  mem.write8 = (a, v) => { if (!inStack && dv.has(a)) dv.set(a, v & 0xff); return w8(a, v); };
  return dv;
}
// IO log: every port write but watchdog port 6, plus INTE, tagged with the frame (ISR writes included on both sides).
function logIo(m, st) {
  const io = [], out = m.io.portOut.bind(m.io), inte = m.io.setInte.bind(m.io);
  m.io.portOut = (p, v) => { if (p !== 0x06) io.push(`${st.ticks}:${p}=${v}`); return out(p, v); };
  m.io.setInte = (on) => { io.push(`${st.ticks}:inte=${!!on}`); return inte(on); };
  return io;
}

function installFrameModel(m, strict) {
  const mem = m.mem, r8 = mem.read8.bind(mem), w8 = mem.write8.bind(mem);
  const st = { ticks: 0, armed: false, inIsr: false, pendingYield: false, strict };
  const tick0 = m.tick.bind(m);
  let isrStart = 0; // an ISR that runs past 4 frames of cycles is a hang: bound it too
  m.tick = (n) => { tick0(n); if (st.inIsr && m.cycles - isrStart > 4 * 33536) throw BOUND; };
  mem.read8 = (addr) => {
    if (!st.inIsr && addr === CELL) {
      if (st.armed) {
        if (st.strict && !st.pendingYield) assert.fail("frame ticked with no yield");
        st.pendingYield = false;
        if (++st.ticks > CAP) throw BOUND;
        st.inIsr = true; isrStart = m.cycles;
        try { m.pcKnown = true; m.fireNmi(); } finally { st.inIsr = false; }
      }
      st.armed = true;
    }
    return r8(addr);
  };
  mem.write8 = (addr, v) => { if (!st.inIsr && addr === CELL) st.armed = false; w8(addr, v); };
  return st;
}

function runOracle(cap, a) {
  const m = prep(cap);
  if (a !== undefined) m.regs.a = a;
  const st = installFrameModel(m, false), io = logIo(m, st), stack = shadowStack(m);
  oracle(m);
  return { m, frames: st.ticks, io, stack };
}

function runIdiomatic(cap, a, fn = runAttractAnimTask) {
  const m = prep(cap);
  const st = installFrameModel(m, true), io = logIo(m, st), stack = shadowStack(m);
  const gen = fn(m);
  let yields = 0;
  try {
    for (let r = gen.next(); !r.done; r = gen.next()) {
      if (st.pendingYield) assert.fail("yielded twice with no poll between");
      st.pendingYield = true;
      if (++yields > CAP) throw BOUND;
    }
  } catch (e) { if (e === BOUND) assert.fail("the idiomatic wait hit the frame bound"); throw e; }
  assert.equal(st.pendingYield, false, "a trailing yield was never consumed by a poll");
  return { m, frames: st.ticks, yields, io, stack };
}

// The oracle's pushed cells in the dead 0x10 bytes below the entry SP are compared on their data view (the module's
// own view if it pushed there, else its raw value); every other cell raw (ISR pushes deeper are identical both sides).
function diff(o, c, sp) {
  const ex = (a) => a != null && o.stack.has(a) && a >= sp - 0x10 && a < sp;
  const d = firstStateDiff(o.m.dumpState(), c.m.dumpState(), (off) => o.m.stateOffsetToAddr(off), ex);
  if (d) return d;
  const view = (r, a) => (r.stack.has(a) ? r.stack.get(a) : r.m.mem.ram[a - 0x2000]);
  for (const a of [...o.stack.keys()].filter(ex).sort((x, y) => x - y)) {
    if (view(o, a) !== view(c, a)) return { addr: a, a: view(o, a), b: view(c, a) };
  }
  return null;
}

function check(cap, a, label, fn) {
  const o = runOracle(cap, a), c = runIdiomatic(cap, a, fn);
  for (const a of c.stack.keys()) assert.ok(o.stack.has(a), `${label}: idiomatic stack write ${hx(a)} outside the oracle's`);
  const d = diff(o, c, cap.regs.sp);
  assert.equal(d, null, d && `${label}: RAM diverged at ${hx(d.addr)} (oracle=${d.a} idiomatic=${d.b})`);
  assert.equal(c.m.regs.sp, cap.regs.sp, `${label}: idiomatic SP untouched`);
  assert.equal(o.m.regs.sp, (cap.regs.sp + 2) & 0xffff, `${label}: oracle SP popped by its ret`);
  assert.equal(c.frames, o.frames, `${label}: frames elapsed`);
  assert.equal(c.yields, c.frames, `${label}: one yield per frame`);
  assert.equal(o.m.intCount, 2 * o.frames, `${label}: the RST1+RST2 pair ran each frame`);
  assert.deepEqual(c.io, o.io, `${label}: port writes / INTE`);
  // Watchdog (io, not RAM): the oracle kicks once per poll (frames+1), the module once per waited frame. Pin both.
  for (const [side, r] of [["oracle", o], ["idiomatic", c]]) {
    assert.ok(r.m.io.watchdogKicks - cap.io.watchdogKicks >= r.frames, `${label}: ${side} kicked the watchdog every frame`);
  }
  assert.equal(o.m.io.watchdogKicks - cap.io.watchdogKicks, o.frames + 1, `${label}: oracle kicks once per poll`);
  assert.equal(c.m.io.watchdogKicks - cap.io.watchdogKicks, c.frames, `${label}: module kicks once per waited frame`);
  return o;
}

test("CAPTURE: real 0x0a80 dispatches -- runAttractAnimTask == oracle (RAM -stack, frames)", () => {
  assert.ok(CAPS.length >= 3, "expected the three attract reveal animations to dispatch 0x0a80");
  for (const cap of CAPS) {
    const o = check(cap, undefined, `ret=${hx(cap.mem.read16(cap.regs.sp))}`);
    assert.ok(o.frames > 0, "the animation ran for at least one frame");
    assert.equal(o.m.mem.read8(TASK_FLAGS), 0, "task disarmed");
    assert.notEqual(o.m.mem.read8(CELL), 0, "done flag raised by the ISR");
  }
});

test("CRAFTED: flag already raised on entry (zero frames, any nonzero); stale TASK_FLAGS values on entry", () => {
  const base = CAPS[0];
  for (const v of [0x01, 0x02, 0x80]) {
    const raised = base.clone(); raised.mem.write8(CELL, v);
    assert.equal(check(raised, undefined, `flag pre-raised ${hx(v)}`).frames, 0);
  }
  for (const v of [0x04, 0x01]) {
    const stale = base.clone(); stale.mem.write8(TASK_FLAGS, v);
    check(stale, undefined, `stale TASK_FLAGS=${hx(v)}`);
  }
});

test("TEETH: broken twins are caught", () => {
  const base = CAPS[0];
  const twin = (arm, clear) => function* (m) {
    m.mem8[TASK_FLAGS] = arm;
    while (m.mem8[CELL] === 0) { m.io.portOut(0x06, 0x02); yield; }
    if (clear) m.mem8[TASK_FLAGS] = 0x00;
  };
  assert.doesNotThrow(() => check(base, undefined, "faithful", twin(0x02, true)));
  for (const [name, fn] of [["arm 0x04", twin(0x04, true)], ["arm 0x03", twin(0x03, true)], ["no disarm", twin(0x02, false)]]) {
    assert.throws(() => check(base, undefined, name, fn), assert.AssertionError, `twin "${name}" not caught`);
  }  // A plain store into an excluded stack cell must show on the data view.
  for (const cap of CAPS) for (const k of [2, 4]) {
    const plant = function* (m) { yield* runAttractAnimTask(m); m.mem8[(cap.regs.sp - k) & 0xffff] ^= 0xa5; };
    assert.throws(() => check(cap, undefined, `store sp-${k}`, plant), assert.AssertionError,
      `planted store sp-${k} at sp=${hx(cap.regs.sp)} not caught`);
  }
});

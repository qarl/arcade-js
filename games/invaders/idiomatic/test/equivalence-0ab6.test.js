// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for waitLongDelay (ROM 0x0ab6, generator): a 0x80-frame FRAME_DELAY_TIMER wait -- the oracle tail-jumps into loc_0ad7.
// FRAME MODEL (identical hook on both sides): a poll of 0x20c0 after the first since its last seed fires the
// translated RST1+RST2 pair (m.fireNmi) once -- one frame between polls. The idiomatic side must yield exactly
// once before each such tick (strict), so yields == frames. A tick cap throws BOUND (a non-terminating wait).
// Contract: RAM (dumpState) except the cells the oracle's push16 wrote this run (the ISR pushes the interrupted
// registers below the entry SP; they differ by design), each still comparing its last non-stack write (or entry
// value) on both sides; plus the elapsed frame count, the port/INTE log (port 6 aside) and the watchdog kick count.
// Later attract cycles enter with SP=0x2732/0x272c, inside the VRAM bitmap, so those pushes land on display bytes:
// only cells actually pushed are excluded, never a fixed window. SP: idiomatic untouched, oracle +2 (its ret);
// pc excluded: the generator never executes the ROM ret.
// LIVE-OUT: none -- A (=0) is overwritten before any read at every return site (0b17/0bc6 lda, 0318 xra,
// 0b4a/16d7->09d6, 0bda (189e tail at 18d1) mov a,m). Flags are dead too: set before any test (0b1a ana a,
// 0bc9 cpi, 0318 xra; the callees set them on the call paths).
// Run: node --test games/invaders/idiomatic/test/equivalence-0ab6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0ab6 as oracle } from "../../translated/loc_0ab6.js";
import { waitLongDelay } from "../waitLongDelay.js";
import { waitFrames } from "../waitFrames.js";
import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { FRAME_DELAY_TIMER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0ab6;
const SEED = 0x80;
const CELL = FRAME_DELAY_TIMER;
const CAP = 0x400;
const BOUND = Symbol("bound");
const ORACLE_ROUTINES = buildRoutines(); // the frame tick runs the translated ISRs, never the idiomatic ones
const hx = (v) => "0x" + (v & 0xffff).toString(16);

function capture(K, frames) {
  const caps = [], keys = new Set();
  const hook = new Map([[TARGET, (mm) => {
    const key = `${mm.regs.sp}:${mm.regs.a}:${mm.mem.read16(mm.regs.sp)}`;
    if (caps.length < K && !keys.has(key)) { keys.add(key); caps.push(mm.clone()); }
    return oracle(mm);
  }]]);
  new Machine(ROM, { overrides: hook }).runFrames(frames);
  return caps;
}
const CAPS = ROM_PRESENT ? capture(8, 2400) : [];

function prep(cap) {
  const m = cap.clone();
  m.io.setInte(false);
  m.routines = ORACLE_ROUTINES; m.idiomaticVblankNmi = m.idiomaticMidNmi = undefined;
  m.nextInt1 = m.nextInt2 = m.nextBoundary = m.maxCycles = Infinity;
  return m;
}

// Stack shadow: cells push16/write16(xthl) wrote, and per cell the last NON-stack write.
function shadow(m) {
  const pushed = new Set(), ns = new Map(), mem = m.mem, w8 = mem.write8.bind(mem), w16 = mem.write16.bind(mem);
  const push0 = m.push16.bind(m); let inStack = false;
  // Key by the decoded cell (global_mask 0x7fff, RAM mirror 0x6000-0x7fff -> 0x2000-0x3fff) so an aliased store is seen.
  const cell = (a) => { a &= 0x7fff; return a >= 0x6000 ? a - 0x4000 : a; };
  mem.write8 = (a, v) => { if (!inStack) ns.set(cell(a), v & 0xff); return w8(a, v); };
  // Only a write16 AT SP (xthl) is a stack write; any other 16-bit store (shld) is a plain store and is recorded.
  mem.write16 = (a, v) => { const st = (a & 0xffff) === m.regs.sp; if (st) inStack = true; try { return w16(a, v); } finally { if (st) inStack = false; } };
  m.push16 = (v) => { inStack = true; try { push0(v); } finally { inStack = false; } pushed.add(m.regs.sp).add((m.regs.sp + 1) & 0xffff); };
  return { pushed, ns };
}

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
  const { pushed, ns } = shadow(m);
  const st = installFrameModel(m, false), io = logIo(m, st);
  oracle(m);
  return { m, frames: st.ticks, pushed, ns, io };
}

function runIdiomatic(cap, a, fn = waitLongDelay) {
  const m = prep(cap);
  const { ns } = shadow(m);
  const st = installFrameModel(m, true), io = logIo(m, st);
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
  return { m, frames: st.ticks, yields, ns, io };
}

function diff(o, c, pushed) {
  const ex = (a) => a != null && (pushed.has(a));
  return firstStateDiff(o.dumpState(), c.dumpState(), (off) => o.stateOffsetToAddr(off), ex);
}

function check(cap, a, label, fn) {
  const o = runOracle(cap, a), c = runIdiomatic(cap, a, fn);
  const d = diff(o.m, c.m, o.pushed);
  assert.equal(d, null, d && `${label}: RAM diverged at ${hx(d.addr)} (oracle=${d.a} idiomatic=${d.b})`);
  for (const a of o.pushed) { // an excluded cell still compares its last non-stack value (or entry value)
    const e = cap.mem.read8(a), vo = o.ns.has(a) ? o.ns.get(a) : e, vc = c.ns.has(a) ? c.ns.get(a) : e;
    assert.equal(vc, vo, `${label}: non-stack write under the stack shadow at ${hx(a)}`);
  }
  assert.equal(c.frames, o.frames, `${label}: frames elapsed`);
  assert.equal(c.yields, c.frames, `${label}: one yield per frame`);
  assert.deepEqual(c.io, o.io, `${label}: port writes / INTE`);
  assert.equal(c.m.io.watchdogKicks, o.m.io.watchdogKicks, `${label}: watchdog kicks`);
  assert.equal(c.m.regs.sp, cap.regs.sp, `${label}: idiomatic SP untouched`);
  assert.equal(o.m.regs.sp, (cap.regs.sp + 2) & 0xffff, `${label}: oracle SP after ret`);
  assert.equal(o.m.intCount, 2 * o.frames, `${label}: the RST1+RST2 pair ran each frame`);
  return o;
}

test("CAPTURE: real 0x0ab6 dispatches -- waitLongDelay == oracle (RAM -stack, frames)", () => {
  assert.ok(CAPS.length >= 2, "expected several attract call sites to dispatch 0x0ab6");
  for (const cap of CAPS) {
    const o = check(cap, undefined, `ret=${hx(cap.mem.read16(cap.regs.sp))}`);
    assert.equal(o.frames, SEED, "oracle waited exactly the fixed seed");
  }
});

test("CRAFTED: entry A and a pre-dirtied counter are both ignored (the seed overwrites them)", () => {
  const base = CAPS[0];
  for (const a of [0x00, 0x01, 0xff]) check(base, a, `a=${hx(a)}`);
  const dirty = base.clone(); dirty.mem.write8(CELL, 0x33);
  check(dirty, undefined, "dirty counter");
});

test("TEETH: broken twins are caught", () => {
  const base = CAPS[0];
  assert.doesNotThrow(() => check(base, undefined, "faithful", function* (m) { yield* waitFrames(m, SEED); }));
  for (const [name, seed] of [["seed-1", SEED - 1], ["seed+1", SEED + 1], ["other delay", SEED ^ 0xc0]]) {
    const fn = function* (m) { yield* waitFrames(m, seed); };
    assert.throws(() => check(base, undefined, name, fn), assert.AssertionError, `twin "${name}" not caught`);
  }
  assert.throws(() => check(base, undefined, "no wait", function* () {}), assert.AssertionError);
});

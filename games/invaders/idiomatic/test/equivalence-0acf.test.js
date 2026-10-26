// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for typeAttractBlock (ROM 0x0acf, generator): seat hl=0x2b14 c=0x0f, tail into loc_0a93 (de = caller).
// FRAME MODEL (identical hook on both sides): a poll of 0x20c0 after the first since its last seed fires the
// translated RST1+RST2 pair (m.fireNmi) once. The idiomatic side must yield exactly once before each tick.
// A tick cap throws BOUND. Contract: RAM, the cells the oracle's push16/xthl wrote in the 0x10 bytes below the entry
// SP compared on their data view (the idiomatic side's own stack writes must fall inside the oracle's), the frame
// count, the port/INTE log (port 6 excepted) and the watchdog kick count; idiomatic SP untouched, oracle SP =
// entry+2 (the ret reached through the 0x0a93 tail); pc excluded.
// LIVE-OUT: none. Sole return site 0x0b0e (loc_0aea) calls 0x0ab1 (seeds A) then 0x1815 (lxi h, lxi d, mvi c) before
// any read, so the DE/HL/C/A the oracle leaves are dead.
// Run: node --test games/invaders/idiomatic/test/equivalence-0acf.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0acf as oracle } from "../../translated/loc_0acf.js";
import { typeAttractBlock } from "../typeAttractBlock.js";
import { typePacedSpriteRun } from "../typePacedSpriteRun.js";
import { drawSprite8x8 } from "../drawSprite8x8.js";
import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { FRAME_DELAY_TIMER, SPACE_INVADERS_TITLE_TEXT, ATTRACT_BODY_SCREEN_ADDR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0acf;
const CELL = FRAME_DELAY_TIMER;
const CAP = 0x800;
const BOUND = Symbol("bound");
const ORACLE_ROUTINES = buildRoutines(); // the frame tick runs the translated ISRs, never the idiomatic ones
const hx = (v) => "0x" + (v & 0xffff).toString(16);

function capture(K, frames) {
  const caps = [];
  const hook = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: hook }).runFrames(frames);
  return caps;
}
// One dispatch per attract cycle (~frames 97 and 1910): same SP/regs, different work RAM and VRAM.
const CAPS = ROM_PRESENT ? capture(2, 2400) : [];

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

function runOracle(cap, r) {
  const m = prep(cap);
  m.regs.de = r.de; m.regs.c = r.c; m.regs.hl = r.hl;
  const st = installFrameModel(m, false), io = logIo(m, st), stack = shadowStack(m);
  oracle(m);
  return { m, frames: st.ticks, io, stack };
}

function runIdiomatic(cap, r, fn = typeAttractBlock) {
  const m = prep(cap);
  const st = installFrameModel(m, true), io = logIo(m, st), stack = shadowStack(m);
  const gen = fn(m, r.de);
  let yields = 0;
  try {
    for (let x = gen.next(); !x.done; x = gen.next()) {
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

const regsOf = (cap) => ({ de: cap.regs.de, c: cap.regs.c, hl: cap.regs.hl });

function check(cap, r, label, fn) {
  const o = runOracle(cap, r), c = runIdiomatic(cap, r, fn);
  for (const a of c.stack.keys()) assert.ok(o.stack.has(a), `${label}: idiomatic stack write ${hx(a)} outside the oracle's`);
  const d = diff(o, c, cap.regs.sp);
  assert.equal(d, null, d && `${label}: RAM diverged at ${hx(d.addr)} (oracle=${d.a} idiomatic=${d.b})`);
  assert.equal(c.m.regs.sp, cap.regs.sp, `${label}: idiomatic SP untouched`);
  assert.equal(o.m.regs.sp, (cap.regs.sp + 2) & 0xffff, `${label}: oracle SP popped by its ret`);
  assert.equal(c.frames, o.frames, `${label}: frames elapsed`);
  assert.equal(c.yields, c.frames, `${label}: one yield per frame`);
  assert.equal(o.m.intCount, 2 * o.frames, `${label}: the RST1+RST2 pair ran each frame`);
  assert.deepEqual(c.io, o.io, `${label}: port writes / INTE`);
  assert.equal(c.m.io.watchdogKicks, o.m.io.watchdogKicks, `${label}: watchdog kicks`);
  return o;
}

test("CAPTURE: real 0x0acf dispatches -- typeAttractBlock == oracle (RAM -stack, frames)", () => {
  assert.equal(CAPS.length, 2, "expected the attract body block to dispatch 0x0acf in both attract cycles");
  for (const [i, cap] of CAPS.entries()) {
    const o = check(cap, regsOf(cap), `cap ${i} de=${hx(cap.regs.de)} sp=${hx(cap.regs.sp)}`);
    assert.equal(o.frames, 6 * 0x0f, "oracle typed 0x0f glyphs at 6 frames each");
  }
});

test("CRAFTED: other sources; entry hl / c are ignored (seated by the routine)", () => {
  const base = CAPS[0];
  for (const de of [0x1cfe, 0x1a00, 0x2000]) check(base, { de, c: 0x77, hl: 0x3333 }, `de=${hx(de)}`);
});

test("TEETH: broken twins are caught", () => {
  const base = CAPS[0];
  const r = regsOf(base);
  const twin = (de, c, hl) => function* (m, src) { yield* typePacedSpriteRun(m, de ?? src, c, hl); };
  assert.doesNotThrow(() => check(base, r, "faithful", twin(null, 0x0f, ATTRACT_BODY_SCREEN_ADDR)));
  for (const [name, fn] of [
    ["count 0x0e", twin(null, 0x0e, ATTRACT_BODY_SCREEN_ADDR)],
    ["count 0x10", twin(null, 0x10, ATTRACT_BODY_SCREEN_ADDR)],
    ["dest +1", twin(null, 0x0f, ATTRACT_BODY_SCREEN_ADDR + 1)],
    ["fixed source", twin(SPACE_INVADERS_TITLE_TEXT + 1, 0x0f, ATTRACT_BODY_SCREEN_ADDR)],
  ]) {
    assert.throws(() => check(base, r, name, fn), assert.AssertionError, `twin "${name}" not caught`);
  }  // A plain store into an excluded stack cell must show on the data view.
  for (const cap of CAPS) for (const k of [2, 4]) {
    const plant = function* (m, src) { yield* typeAttractBlock(m, src); m.mem8[(cap.regs.sp - k) & 0xffff] ^= 0xa5; };
    assert.throws(() => check(cap, regsOf(cap), `store sp-${k}`, plant), assert.AssertionError,
      `planted store sp-${k} at sp=${hx(cap.regs.sp)} not caught`);
  }
});

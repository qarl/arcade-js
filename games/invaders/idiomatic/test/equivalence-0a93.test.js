// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for typePacedSpriteRun (ROM 0x0a93, generator): draw c glyphs from de at hl, 7-seed pace each.
// FRAME MODEL (identical hook on both sides): a poll of 0x20c0 after the first since its last seed fires the
// translated RST1+RST2 pair (m.fireNmi) once. The idiomatic side must yield exactly once before each tick.
// A tick cap throws BOUND. Contract: RAM except the cells the oracle's push16 wrote this run (0a93 push d, the
// 0x08ff call, and the ISR register pushes below the entry SP; they differ by design), each still comparing its last
// non-stack write (or entry value) on both sides; plus the frame count, the port/INTE log (port 6 aside) and the
// watchdog kick count.
// SP: idiomatic untouched, oracle +2 (its ret); pc excluded (the generator never runs the ROM ret). Later attract cycles enter with SP=0x2732/0x272c, inside the
// VRAM bitmap, so those pushes land on display bytes: only cells actually pushed are excluded, never a fixed window.
// LIVE-OUT (oracle callers): DE is read at 0x0bee (-> 0x0b0b loc_0acf types from it) and HL at 0x16aa (dec h x2,
// then 0x08ff). Both readers are idiomatic (runAttractCycle 0x0aea, gameOverFlow 0x1671) and pass constants:
// the HAND-OFF arm pins those constants to the oracle's live-out. A/B/C/flags at the other return sites, each killed
// by the instruction that overwrites it: 0b08 lxi d kills DE, then A/C die in 0acf (mvi c) and 0a93 (ldax d);
// 1854 pop b restores BC, then A dies at 0bb7 (in 0x02) and flags at 0bc3 (0ab6 ana a) or 1841->1856 cpi;
// 0b0e/16d4/17f7 call waits that set A and flags before any read. DE/HL are dead at these non-hand-off sites:
// 0b0e (via 0b11)->1815 lxi h/d; 16d4->09d6 lxi h; 17f7->16c9 lxi h/d; 1854->1856 record load (rc path: lxi d/lxi h);
// 0bb7 (0b89) -> 0bce lxi d / 0bda lxi h.
// Run: node --test games/invaders/idiomatic/test/equivalence-0a93.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a93 as oracle } from "../../translated/loc_0a93.js";
import { typePacedSpriteRun } from "../typePacedSpriteRun.js";
import { drawSprite8x8 } from "../drawSprite8x8.js";
import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import {
  FRAME_DELAY_TIMER, SPACE_INVADERS_TITLE_TEXT, ATTRACT_PLAY_HEADING_TEXT, ATTRACT_HEADING_SCREEN_ADDR,
  GAME_OVER_TEXT, GAME_OVER_BANNER_SCREEN_ADDR, GAMEOVER_PLAYER_NUM_SCREEN_ADDR, TILT_BANNER_TEXT, TILT_BANNER_VRAM,
  GAME_OVER_TEXT_VRAM_ADDR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0a93;
const CELL = FRAME_DELAY_TIMER;
const CAP = 0x800;
const BOUND = Symbol("bound");
const ORACLE_ROUTINES = buildRoutines(); // the frame tick runs the translated ISRs, never the idiomatic ones
const hx = (v) => "0x" + (v & 0xffff).toString(16);

function capture(K, frames) {
  const caps = [], keys = new Set();
  const hook = new Map([[TARGET, (mm) => {
    const key = `${mm.regs.sp}:${mm.regs.de}:${mm.regs.c}:${mm.regs.hl}:${mm.mem.read16(mm.regs.sp)}`;
    if (caps.length < K && !keys.has(key)) { keys.add(key); caps.push(mm.clone()); }
    return oracle(mm);
  }]]);
  new Machine(ROM, { overrides: hook }).runFrames(frames);
  return caps;
}
const CAPS = ROM_PRESENT ? capture(12, 2400) : [];

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

function runOracle(cap, r) {
  const m = prep(cap);
  m.regs.de = r.de; m.regs.c = r.c; m.regs.hl = r.hl;
  const { pushed, ns } = shadow(m);
  const st = installFrameModel(m, false), io = logIo(m, st);
  oracle(m);
  return { m, frames: st.ticks, pushed, ns, io };
}

function runIdiomatic(cap, r, fn = typePacedSpriteRun) {
  const m = prep(cap);
  const { ns } = shadow(m);
  const st = installFrameModel(m, true), io = logIo(m, st);
  const gen = fn(m, r.de, r.c, r.hl);
  let yields = 0;
  try {
    for (let x = gen.next(); !x.done; x = gen.next()) {
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

const regsOf = (cap) => ({ de: cap.regs.de, c: cap.regs.c, hl: cap.regs.hl });

function check(cap, r, label, fn) {
  const o = runOracle(cap, r), c = runIdiomatic(cap, r, fn);
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

test("CAPTURE: real 0x0a93 dispatches -- typePacedSpriteRun == oracle (RAM -stack, frames)", () => {
  assert.ok(CAPS.length >= 4, "expected the attract heading/body/script runs to dispatch 0x0a93");
  for (const cap of CAPS) {
    const r = regsOf(cap);
    const o = check(cap, r, `de=${hx(r.de)} c=${r.c} hl=${hx(r.hl)}`);
    assert.equal(o.frames, 6 * (r.c || 256), "oracle paced 6 frames per glyph");
  }
});

test("CRAFTED: c = 1, c = 0 (256-glyph wrap), and the game-over / tilt / field-clear call sites", () => {
  const base = CAPS[0];
  check(base, { de: 0x1daf, c: 1, hl: 0x2b14 }, "c=1");
  check(base, { de: 0x1a00, c: 0, hl: 0x2400 }, "c=0");
  check(base, { de: GAME_OVER_TEXT, c: 0x14, hl: GAME_OVER_BANNER_SCREEN_ADDR }, "game over 0x1671");
  check(base, { de: TILT_BANNER_TEXT, c: 0x04, hl: TILT_BANNER_VRAM }, "tilt 0x17cd");
  check(base, { de: GAME_OVER_TEXT, c: 0x0a, hl: GAME_OVER_TEXT_VRAM_ADDR }, "field clear 0x16c9");
  check(base, { de: 0x1efd, c: 6, hl: 0x2b14 }, "page-crossing source with id 0x4e");
});

test("HAND-OFF: the idiomatic readers' constants equal the oracle's DE / HL live-out", () => {
  const base = CAPS[0];
  const head = runOracle(base, { de: ATTRACT_PLAY_HEADING_TEXT, c: 0x04, hl: ATTRACT_HEADING_SCREEN_ADDR });
  assert.equal(head.m.regs.de, SPACE_INVADERS_TITLE_TEXT, "DE live-out at 0x0bee (read by 0x0acf)");
  const over = runOracle(base, { de: GAME_OVER_TEXT, c: 0x14, hl: GAME_OVER_BANNER_SCREEN_ADDR });
  assert.equal((over.m.regs.hl - 0x200) & 0xffff, GAMEOVER_PLAYER_NUM_SCREEN_ADDR, "HL live-out at 0x16aa (dec h x2)");
});

test("TEETH: broken twins are caught", () => {
  const base = CAPS[0];
  const r = regsOf(base);
  const twin = (pace, stop, stepDe) => function* (m, de, c, hl) {
    let src = de, n = c, dst = hl;
    for (;;) {
      dst = drawSprite8x8(m, m.mem8[src], dst);
      m.mem8[CELL] = pace;
      while (((m.mem8[CELL] - 1) & 0xff) !== stop) yield;
      src = (src + stepDe) & 0xffff; n = (n - 1) & 0xff;
      if (n === 0) break;
    }
  };
  assert.doesNotThrow(() => check(base, r, "faithful twin", twin(7, 0, 1)), "twin harness is faithful");
  for (const [name, fn] of [["pace 6", twin(6, 0, 1)], ["stop at 2", twin(7, 1, 1)], ["src += 2", twin(7, 0, 2)]]) {
    assert.throws(() => check(base, r, name, fn), assert.AssertionError, `twin "${name}" not caught`);
  }
});

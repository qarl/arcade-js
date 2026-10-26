// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for buildBoardWhenTimerExpires (ROM 0x0C91) — the countdown-gated board (re)build:
 * tick SUBSTATE_TIMER (0x6009) down by one and, ONLY on the frame it reaches zero, run the
 * board builder (buildBoard / ROM 0x0C92). While the timer is still above zero the routine
 * does nothing this frame.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the
 * retired strict whole-machine one. The two sides are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP), PLUS the palette-bank output latch.
 *
 * pc and SP are deliberately NOT compared: the oracle models the rst-0x18 skip idiom with
 * push16/step/ret (it pushes the fall-through address 0x0C92, then either returns to it —
 * build — or discards it and returns two levels up — skip). All that traffic lands in the
 * dead STACK_SCRATCH region, which the direct-call idiomatic side replaces with a plain JS
 * `if (!tickSubstateTimer(m)) return; buildBoard(m);`. The caller consumes no return value.
 * The palette-bank latch is I/O device state (io.paletteBank), NOT part of dumpState — the
 * display reads it to pick its colour set — so it is checked directly alongside the RAM diff.
 *
 * REACHABILITY. buildBoardWhenTimerExpires is the 0x0702 sub-state table's index-10 arm (game state 3, sub-
 * state 0x0A), the in-PLAY entry into the builder; a plain attract run never reaches it
 * (attract's 25m build comes in through handler_0763's ungated tail jump instead). So each
 * board's real entry is FORCED with an identical-both-sides board poke at frame 100
 * (GAME_STATE=3, GAME_SUBSTATE=0x0A, SUBSTATE_TIMER=1, BOARD=1..4); buildBoardWhenTimerExpires then dispatches
 * once under the vblank service with the real board, giving a REAL captured entry (real
 * register file, real stack, entry SP in STACK_SCRATCH). timer==1 at entry makes those the
 * EXPIRY / build path; the SKIP path is crafted by poking a larger timer (and the timer==0
 * wrap-past-zero) identically on both sides of a captured entry.
 *
 * Jobs:
 *   1. EQUAL (build / expiry) — for every board 1..4, oracle vs buildBoardWhenTimerExpires on fresh clones of
 *      the real entry leave identical RAM (−STACK_SCRATCH) and identical palette bank. Both
 *      clones are pre-seeded with a sentinel palette bank + a sentinel BONUS_DISPLAY so a
 *      match proves the writes actually happened. Non-vacuous: the timer decremented into
 *      the builder, BONUS_DISPLAY was reset to 0, SND_BGM + palette bank hold the board's
 *      values, and SUBSTATE_TIMER was reloaded by the setup arm (to 64). The dead stack
 *      traffic is proven load-bearing to the mask (stackDiffCount > 0).
 *   2. EQUAL (skip / still counting) — poke SUBSTATE_TIMER to 5, 2 (the just-above-expiry
 *      boundary), and 0 (wrap-past-zero: expiry is only the 1->0 tick, never 0->255)
 *      identically on both sides. oracle vs buildBoardWhenTimerExpires leave identical RAM (−STACK_SCRATCH):
 *      the timer counts down one and NOTHING else changes (the builder did not run — the
 *      sentinel BONUS_DISPLAY survives).
 *   3. TEETH — two broken twins, each MUST be caught on a skip-path entry:
 *      (a) inverted gate — builds the board while the timer is still counting; the builder's
 *          writes (BONUS_DISPLAY reset, palette bank, tune) show up where the correct routine
 *          leaves them untouched.
 *      (b) dropped countdown tick — never decrements SUBSTATE_TIMER; caught at SUBSTATE_TIMER
 *          on the skip path (correct 4 vs twin 5), where the builder does not overwrite it.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0c91.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0c91 as oracle } from "../../translated/loc_0c91.js";
import { buildBoardWhenTimerExpires as idiomatic } from "../buildBoardWhenTimerExpires.js";
import { buildBoard } from "../buildBoard.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  BOARD,
  SND_BGM,
  BONUS_DISPLAY,
  GAME_STATE,
  GAME_SUBSTATE,
  SUBSTATE_TIMER,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0c91;
const PALETTE_SENTINEL = 0x00;      // a distinct entry bank so a build's latch write shows up
const SCRATCH_SENTINEL = 0xab;      // a distinct entry value in BONUS_DISPLAY so the reset write shows up
const TIMER_RELOAD = 64;            // the setup arm reloads SUBSTATE_TIMER on a build (0x40)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// What a build leaves for each board: the final palette bank and the background tune.
const EXPECTED = {
  1: { bank: 2, bgm: 0x08 }, // 25m — arm leaves the builder's bank 2
  2: { bank: 1, bgm: 0x09 }, // 50m — arm overrides to bank 1
  3: { bank: 2, bgm: 0x0a }, // 75m — arm leaves the builder's bank 2
  4: { bank: 3, bgm: 0x0b }, // 100m rivet — arm raises bit0 to bank 3
};

const inStackScratch = (addr) => addr != null && addr >= STACK_SCRATCH.lo && addr < STACK_SCRATCH.hi;

/**
 * First RAM difference between two machines on the go-forward contract: the whole state
 * dump minus the stack scratch below the entry SP (dead scratch — the oracle pushes the rst-0x18
 * fall-through/return addresses there while the direct-call idiomatic side does not).
 * Returns {addr,a,b,offset} or null. dumpState() returns a fresh array per call, so the
 * dead-stack bytes are neutralised by copying them across before the single diff.
 */
function ramDiffMinusStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  for (let off = 0; off < a.length; off++) {
    if (dead(ma.stateOffsetToAddr(off))) b[off] = a[off]; // mask dead scratch
  }
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off));
}

/** How many of the masked-away diffs actually fell in the dead stack region. */
function stackDiffCount(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  let n = 0;
  for (let off = 0; off < a.length; off++) {
    if (a[off] !== b[off] && dead(ma.stateOffsetToAddr(off))) n++;
  }
  return n;
}

/**
 * Force the real dispatch of buildBoardWhenTimerExpires on a given board via an identical-both-sides poke and
 * clone the machine at each true entry. The wrapper snapshots the entry, then runs the
 * oracle so the host proceeds. timer==1 at entry, so the natural forced entry is the build path.
 */
function captureForced(boardVal, K = 2) {
  const POKE_FRAME = 100;
  const FRAMES = 140; // the forced dispatch lands ~frame 102
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.pokes = [
    { addr: GAME_STATE, val: 0x03, frame: POKE_FRAME, dur: 1 },
    { addr: GAME_SUBSTATE, val: 0x0a, frame: POKE_FRAME, dur: 1 },
    { addr: SUBSTATE_TIMER, val: 0x01, frame: POKE_FRAME, dur: 1 },
    { addr: BOARD, val: boardVal, frame: POKE_FRAME, dur: 1 },
  ];
  host.runFrames(FRAMES);
  return caps;
}

const CAPS = ROM_PRESENT
  ? { 1: captureForced(1), 2: captureForced(2), 3: captureForced(3), 4: captureForced(4) }
  : {};


test("REACHABILITY: buildBoardWhenTimerExpires dispatches the in-play board rebuild for every board", () => {
  for (const board of [1, 2, 3, 4]) {
    assert.ok(CAPS[board].length >= 1, `expected a forced 0x0C91 dispatch for board ${board}; got ${CAPS[board].length}`);
    const cap = CAPS[board][0];
    assert.equal(cap.mem.read8(BOARD), board, `entry must be the board-${board} rebuild`);
    assert.equal(cap.mem.read8(SUBSTATE_TIMER), 1, `entry timer must be 1 (the expiry/build frame) for board ${board}`);
    assert.ok(inStackScratch(cap.regs.sp), `entry SP must sit in STACK_SCRATCH for the exclusion to be sound (SP=${hx(cap.regs.sp)})`);
  }
  console.log(`  REACHABILITY: forced 0x0C91 dispatch captured for boards 1..4 (entry SP in STACK_SCRATCH)`);
});


test("EQUAL (build): buildBoardWhenTimerExpires == oracle in RAM (−stack) and palette bank on every board", () => {
  for (const board of [1, 2, 3, 4]) {
    const cap = CAPS[board][0];
    const { bank, bgm } = EXPECTED[board];

    const o = cap.clone();
    const c = cap.clone();
    // Pre-seed distinct entry state on BOTH sides so a match proves the writes happened.
    o.io.paletteBank = PALETTE_SENTINEL;  c.io.paletteBank = PALETTE_SENTINEL;
    o.mem.write8(BONUS_DISPLAY, SCRATCH_SENTINEL);  c.mem.write8(BONUS_DISPLAY, SCRATCH_SENTINEL);
    oracle(o);
    idiomatic(c);

    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `board ${board}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
    assert.equal(o.io.paletteBank, c.io.paletteBank, `board ${board}: palette bank must match the oracle`);

    // Non-vacuous: the oracle side shows the tick-then-build chain executed...
    assert.equal(o.mem.read8(BONUS_DISPLAY), 0, `board ${board}: oracle must reset BONUS_DISPLAY to 0 (build ran)`);
    assert.equal(o.mem.read8(SND_BGM), bgm, `board ${board}: oracle must queue tune ${hx(bgm)}`);
    assert.equal(o.io.paletteBank, bank, `board ${board}: oracle must select palette bank ${bank}`);
    assert.equal(o.mem.read8(SUBSTATE_TIMER), TIMER_RELOAD, `board ${board}: the setup arm must reload the timer`);
    // ...and the idiomatic side genuinely reproduced them, not merely agreed on unchanged bytes.
    assert.equal(c.mem.read8(BONUS_DISPLAY), 0, `board ${board}: idiomatic must reset BONUS_DISPLAY to 0`);
    assert.equal(c.mem.read8(SND_BGM), bgm, `board ${board}: idiomatic must queue tune ${hx(bgm)}`);
    assert.equal(c.io.paletteBank, bank, `board ${board}: idiomatic must select palette bank ${bank}`);
    assert.equal(c.mem.read8(SUBSTATE_TIMER), TIMER_RELOAD, `board ${board}: idiomatic must reload the timer`);
    assert.ok(stackDiffCount(o, c, cap.regs.sp) > 0, `board ${board}: the oracle's stack traffic must differ (so the STACK_SCRATCH mask is load-bearing)`);
    console.log(`  EQUAL build board ${board}: identical (RAM −stack + bank=${bank}, tune=${hx(bgm)}, timer reloaded)`);
  }
});


test("EQUAL (skip): buildBoardWhenTimerExpires == oracle when the timer has not expired — tick only, no build", () => {
  // timer 5,2 count down without expiring; timer 0 wraps to 255 and still does not build
  // (expiry is only the 1->0 tick). Each poked identically on both sides of a real entry.
  const cases = [
    { timer: 5, out: 4 },
    { timer: 2, out: 1 },   // the just-above-expiry boundary: 2->1, still counting
    { timer: 0, out: 255 }, // wrap-past-zero: 0->255, never treated as expiry
  ];
  for (const board of [1, 2, 3, 4]) {
    const cap = CAPS[board][0];
    for (const { timer, out } of cases) {
      const o = cap.clone();
      const c = cap.clone();
      o.mem.write8(SUBSTATE_TIMER, timer);  c.mem.write8(SUBSTATE_TIMER, timer);
      o.mem.write8(BONUS_DISPLAY, SCRATCH_SENTINEL);  c.mem.write8(BONUS_DISPLAY, SCRATCH_SENTINEL);
      o.io.paletteBank = PALETTE_SENTINEL;  c.io.paletteBank = PALETTE_SENTINEL;
      oracle(o);
      idiomatic(c);

      const d = ramDiffMinusStack(o, c, cap.regs.sp);
      assert.equal(d, null, d && `board ${board} timer ${timer}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
      assert.equal(o.io.paletteBank, c.io.paletteBank, `board ${board} timer ${timer}: palette bank must match`);

      // Non-vacuous: the builder did NOT run — only the timer ticked down by one.
      assert.equal(o.mem.read8(SUBSTATE_TIMER), out, `board ${board} timer ${timer}: oracle must tick the timer to ${out}`);
      assert.equal(c.mem.read8(SUBSTATE_TIMER), out, `board ${board} timer ${timer}: idiomatic must tick the timer to ${out}`);
      assert.equal(o.mem.read8(BONUS_DISPLAY), SCRATCH_SENTINEL, `board ${board} timer ${timer}: oracle must NOT build (BONUS_DISPLAY untouched)`);
      assert.equal(c.mem.read8(BONUS_DISPLAY), SCRATCH_SENTINEL, `board ${board} timer ${timer}: idiomatic must NOT build (BONUS_DISPLAY untouched)`);
      assert.equal(o.io.paletteBank, PALETTE_SENTINEL, `board ${board} timer ${timer}: oracle must NOT touch the palette bank`);
    }
  }
  console.log(`  EQUAL skip: timers {5,2,0} on boards 1..4 tick-only, no build, identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): inverted gate — builds the board WHILE the timer is still counting. */
function brokenInvertedGate(m) {
  if (tickSubstateTimer(m)) return; // BUG: skips on expiry, builds while counting
  buildBoard(m);
}

/** Broken twin (b): builds/skips on the right frames but NEVER ticks the timer down. */
function brokenNoTick(m) {
  const { mem } = m;
  if (mem.read8(SUBSTATE_TIMER) !== 1) return; // BUG: peeks the timer, does not decrement it
  buildBoard(m);
}

test("TEETH: an inverted gate and a dropped countdown tick are CAUGHT", () => {
  const cap = CAPS[1][0];

  // (a) inverted gate on a SKIP entry (timer 5): correct does nothing but tick; the twin
  //     wrongly BUILDS the board, so the builder's writes surface in RAM.
  {
    const o = cap.clone();
    const c = cap.clone();
    o.mem.write8(SUBSTATE_TIMER, 5);  c.mem.write8(SUBSTATE_TIMER, 5);
    o.mem.write8(BONUS_DISPLAY, SCRATCH_SENTINEL);  c.mem.write8(BONUS_DISPLAY, SCRATCH_SENTINEL);
    oracle(o);
    brokenInvertedGate(c);
    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.notEqual(d, null, "the gate FAILED to catch an inverted timer gate — it is worthless");
    console.log(`  TEETH(inverted gate): caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
  }

  // (b) dropped tick on a SKIP entry (timer 5): the builder does not run to overwrite the
  //     timer, so the missing decrement is exposed directly at SUBSTATE_TIMER (4 vs 5).
  {
    const o = cap.clone();
    const c = cap.clone();
    o.mem.write8(SUBSTATE_TIMER, 5);  c.mem.write8(SUBSTATE_TIMER, 5);
    oracle(o);
    brokenNoTick(c);
    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.notEqual(d, null, "the gate FAILED to catch a dropped countdown tick — it is worthless");
    assert.equal(d.addr, SUBSTATE_TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected SUBSTATE_TIMER ${hx(SUBSTATE_TIMER)})`);
    console.log(`  TEETH(dropped tick): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
  }
});

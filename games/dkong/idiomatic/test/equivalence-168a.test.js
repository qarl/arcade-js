// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stageKongClimbPose (ROM 0x168a) — one timer-gated step of the board-advance
 * render sequence: on the frame SUBSTATE_TIMER (0x6009) expires, copy a 40-byte sprite-object
 * template from ROM 0x388C into SPRITE_OBJ_BLOCK, re-stamp 0x690C to 0x66, clear 0x6924 /
 * 0x692C / 0x62AF, then tail into advanceInterludeStepAndLiftKongFigure (advance the 0x6388 step selector, per-board gate,
 * strided subtract). The near-twin of loc_186f, so this test mirrors equivalence-186f.
 *
 * stageKongClimbPose WRITES memory and is NOT a leaf — it runs the idiomatic leaves tickSubstateTimer
 * (rst 0x18 gate, ROM 0x0018), loadSpriteObjectBlock (the fixed 0x28-byte copy, ROM 0x004e) and
 * the tail advanceInterludeStepAndLiftKongFigure (ROM 0x1662) — so it is gated by capture / clone / replay (docs/decompiler-pipeline) with a
 * FRESH clone per case. Its callees are each memory-equivalent to their oracle, so stageKongClimbPose's
 * branch decisions track the oracle; what this test pins is that stageKongClimbPose (a) skips the whole
 * body until the timer expires, (b) on the single expiry frame runs the copy + re-stamp + three
 * clears + tail, and (c) matches the oracle byte-for-byte in game-visible RAM either way — with
 * the twins proving the sweep bites.
 *
 * A 6000-frame attract run dispatches 0x168a ZERO times (it is a credited game's board-advance
 * cutscene step, reached only when GAME_SUBSTATE 0x600A == 0x16, which attract never enters), so
 * — exactly as docs/decompiler-pipeline prescribes for arms attract never reaches — the gate is CRAFTED: a real
 * booted attract machine, cloned, with the relevant bytes surgically poked, then oracle-vs-
 * idiomatic on independent fresh clones. The two behaviour-selecting bytes are swept exhaustively:
 *
 *   1. STRUCTURE — expiry arm (0x6009=1, BOARD=1): game-visible RAM identical; the body did real
 *      work (0x6908 became the ROM template, 0x690C=0x66, 0x6924/0x692C/0x62AF=0, 0x6388++). The
 *      oracle's rst/call/tail pushes land in STACK_SCRATCH (proven load-bearing by a sentinel).
 *      Skip arm (0x6009=5): RAM identical, the block / 0x62AF / selector UNTOUCHED, only 0x6009
 *      decremented.
 *
 *   2. TIMER (exhaustive) — sweep SUBSTATE_TIMER 0..255. stageKongClimbPose == oracle on game-visible RAM
 *      for every value; exactly the ONE value 0x01 takes the work arm (dec → 0), the other 255
 *      skip — pinning the gate branch (and its polarity) across every possible timer byte.
 *
 *   3. BOARD (exhaustive) — on the expiry arm, sweep BOARD 0..255. stageKongClimbPose == oracle for every
 *      board; both arms of advanceInterludeStepAndLiftKongFigure's per-board rst-0x30 gate are exercised (some boards run the
 *      strided field-3 subtract, others do not), so the tail-jump is validated both ways.
 *
 *   4. TEETH — three twins the sweeps MUST catch: (a) drops the 0x690C re-stamp (leaves the
 *      copied 0x00) — caught at 0x690C; (b) drops the 0x62AF clear — caught at 0x62AF;
 *      (c) inverts the timer-gate polarity (runs the body while ticking, skips on expiry) —
 *      caught on both arms.
 *
 *   5. REALISM — hook 0x168a over a long attract run; replay any real dispatch if one occurs,
 *      else record that attract never reaches it (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-168a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_168a as oracle } from "../../translated/loc_168a.js";
import { stageKongClimbPose as idiomatic } from "../stageKongClimbPose.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { advanceInterludeStepAndLiftKongFigure } from "../advanceInterludeStepAndLiftKongFigure.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SUBSTATE_TIMER, SPRITE_OBJ_BLOCK } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x168a;
const SELECTOR = 0x6388; // the board-advance step selector advanceInterludeStepAndLiftKongFigure's tail advances
const BOARD = 0x6227; // read by advanceInterludeStepAndLiftKongFigure's per-board rst-0x30 gate
const COPY_SOURCE = 0x388c; // ROM base of the copied 40-byte sprite-object template
// The 40-byte copy destination: 0x6908..0x692F (10 records x 4 bytes).
const COPY_DEST = Array.from({ length: 0x28 }, (_, k) => SPRITE_OBJ_BLOCK + k);
const STAMP_ADDR = SPRITE_OBJ_BLOCK + 0x04; // 0x690C — copied byte re-stamped to 0x66
const CLEAR_A = SPRITE_OBJ_BLOCK + 0x1c; // 0x6924
const CLEAR_B = SPRITE_OBJ_BLOCK + 0x24; // 0x692C
const BOARD_BOOKKEEPING = 0x62af; // 0x62AF — board-object bookkeeping (unnamed in names.js)
const FIELD3_REC0 = SPRITE_OBJ_BLOCK + 0x03; // 0x690B — field 3 of record 0, advanceInterludeStepAndLiftKongFigure's first strided byte
const BK_SENTINEL = 0x77; // nonzero value planted at 0x62AF so a dropped clear is visible

// SP inside STACK_SCRATCH with headroom for the oracle's rst/call pushes (down to SP-2) and
// its advanceInterludeStepAndLiftKongFigure final `ret` pop (up to SP+2); the idiomatic side touches the stack not at all.
const SP_CRAFT = 0x6bf8;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First game-visible differing RAM byte, EXCLUDING the dead stack-scratch region. */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

// A real booted attract machine, built once and reused as the base for every crafted entry
// (cloned per case, never mutated). Genuine work RAM; only the poked inputs move.
let _base = null;
function base() {
  if (!_base) {
    const host = new Machine(ROM);
    host.runFrames(200);
    assert.equal(host.stoppedBy, null, "attract base run must reach the vblank spin cleanly");
    _base = host.clone();
  }
  return _base;
}

/**
 * Two independent fresh clones of the base (docs/decompiler-pipeline fresh clone per case — this routine writes
 * RAM), each with SUBSTATE_TIMER and BOARD poked, 0x62AF planted with a nonzero sentinel, SP set
 * in STACK_SCRATCH, and a sentinel laid over the push window so the oracle's pushes provably land
 * in the excluded stack region. Returns [oracleClone, candidateClone].
 */
function craftPair(timer, board) {
  const a = base().clone(), b = base().clone();
  for (const m of [a, b]) {
    m.mem.write8(SUBSTATE_TIMER, timer);
    m.mem.write8(BOARD, board);
    m.mem.write8(BOARD_BOOKKEEPING, BK_SENTINEL); // so a dropped 0x62AF clear is visible
    m.regs.sp = SP_CRAFT;
    // Sentinel across [SP-2, SP+2]: identical on both sides, distinct from the bytes the oracle's
    // rst/call/tail push (0x168B / 0x1691 / 0x1669 / 0x166F), so a genuine stack write shows up as
    // a diff that ramDiffMinusStack must exclude.
    for (let off = -2; off <= 2; off++) m.mem.write8((SP_CRAFT + off) & 0xffff, 0x5a);
  }
  return [a, b];
}

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: expiry arm (0x6009=1) does the work; skip arm (0x6009=5) leaves the body untouched", () => {
  // Expiry arm — timer decrements 1 -> 0, so the copy + re-stamp + clears + tail run.
  const [a, b] = craftPair(1, 0x01);
  const aFloor = a.regs.sp;
  const selBefore = a.mem.read8(SELECTOR);
  oracle(a);
  idiomatic(b);
  const { bad, stackDiffs } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // Non-vacuous: the oracle side actually did the work.
  assert.equal(a.mem.read8(SUBSTATE_TIMER), 0, "expiry arm must have decremented the timer to 0");
  assert.equal(a.mem.read8(SPRITE_OBJ_BLOCK), ROM[COPY_SOURCE], "expiry arm must copy the ROM template into 0x6908");
  assert.equal(a.mem.read8(STAMP_ADDR), 0x66, "expiry arm must re-stamp 0x690C to 0x66");
  assert.equal(a.mem.read8(CLEAR_A), 0, "expiry arm must clear 0x6924");
  assert.equal(a.mem.read8(CLEAR_B), 0, "expiry arm must clear 0x692C");
  assert.equal(a.mem.read8(BOARD_BOOKKEEPING), 0, "expiry arm must clear 0x62AF");
  assert.equal(a.mem.read8(SELECTOR), (selBefore + 1) & 0xff, "expiry arm's tail must inc the 0x6388 selector");
  assert.ok(stackDiffs > 0, "the oracle's rst/call/tail pushes must land in STACK_SCRATCH (so the exclusion is load-bearing)");
  assert.ok((SP_CRAFT - 2) >= STACK_SCRATCH.lo && (SP_CRAFT + 2) <= STACK_SCRATCH.hi,
    `oracle push / final-ret targets must stay inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);

  // Skip arm — timer decrements 5 -> 4, so the body must NOT run.
  const [c, d] = craftPair(5, 0x01);
  const cFloor = c.regs.sp;
  const selSkip = c.mem.read8(SELECTOR);
  oracle(c);
  idiomatic(d);
  const skip = ramDiffMinusStack(c, d, cFloor);
  assert.equal(skip.bad, null, skip.bad && `skip-arm RAM diff at ${hx(skip.bad.addr)} (oracle=${skip.bad.a} idiomatic=${skip.bad.b})`);
  assert.equal(c.mem.read8(SUBSTATE_TIMER), 4, "skip arm must decrement the timer to 4");
  assert.equal(c.mem.read8(SELECTOR), selSkip, "skip arm must leave the step selector untouched");
  assert.equal(c.mem.read8(BOARD_BOOKKEEPING), BK_SENTINEL, "skip arm must leave 0x62AF untouched");
  assert.equal(c.mem.read8(STAMP_ADDR), base().mem.read8(STAMP_ADDR), "skip arm must leave 0x690C untouched");
  console.log("  STRUCTURE: expiry arm copies+stamps+clears+advances (stackDiffs>0); skip arm only decrements 0x6009");
});

// -- 2. TIMER (exhaustive) ----------------------------------------------------

test("TIMER (exhaustive): stageKongClimbPose == oracle over all 256 SUBSTATE_TIMER values (gate branch pinned)", () => {
  let count = 0, worked = 0, skipped = 0, mismatch = null;
  for (let timer = 0; timer < 256 && !mismatch; timer++) {
    const [a, b] = craftPair(timer, 0x01);
    const aFloor = a.regs.sp;
    const selBefore = a.mem.read8(SELECTOR);
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    // Classify from the oracle: the work arm advances the step selector (via the tail).
    if (a.mem.read8(SELECTOR) !== selBefore) worked++; else skipped++;
    if (bad) mismatch = { timer, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at SUBSTATE_TIMER=${hx(mismatch.timer)}: RAM diff at ` +
      `${hx(mismatch.bad.addr)} (oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 timer values");
  assert.equal(worked, 1, "exactly one timer value (0x01) must take the work arm (dec -> 0)");
  assert.equal(skipped, 255, "the other 255 timer values must skip the body");
  console.log(`  TIMER/exhaustive: 256 values — RAM identical (1 works, 255 skip)`);
});

// -- 3. BOARD (exhaustive) ----------------------------------------------------

test("BOARD (exhaustive): on the expiry arm stageKongClimbPose == oracle over all 256 boards, both tail arms hit", () => {
  let count = 0, ran = 0, notRan = 0, mismatch = null;
  for (let board = 0; board < 256 && !mismatch; board++) {
    const [a, b] = craftPair(1, board);
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    // The tail's per-board gate runs the strided field-3 subtract (0x690B -= 4) only on its
    // set arm; 0x690B copied = ROM[0x388F] = 0x3C, so 0x38 => subtract ran, 0x3C => it did not.
    const f3 = a.mem.read8(FIELD3_REC0);
    if (f3 === ((ROM[COPY_SOURCE + 3] - 4) & 0xff)) ran++;
    else if (f3 === ROM[COPY_SOURCE + 3]) notRan++;
    if (bad) mismatch = { board, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at BOARD=${hx(mismatch.board)}: RAM diff at ` +
      `${hx(mismatch.bad.addr)} (oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 board values");
  assert.ok(ran > 0, "some boards must take advanceInterludeStepAndLiftKongFigure's strided-subtract arm");
  assert.ok(notRan > 0, "some boards must skip advanceInterludeStepAndLiftKongFigure's strided-subtract arm");
  console.log(`  BOARD/exhaustive: 256 boards — RAM identical (${ran} run the strided subtract, ${notRan} skip it)`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): drops the 0x690C re-stamp (leaves the copied 0x00). Everything else faithful. */
function brokenNoStamp(m) {
  const { regs, mem } = m;
  if (!tickSubstateTimer(m)) return;
  regs.hl = COPY_SOURCE;
  loadSpriteObjectBlock(m);
  // BUG: no `ld (0x690c),0x66`.
  mem.write8(CLEAR_A, 0);
  mem.write8(CLEAR_B, 0);
  mem.write8(BOARD_BOOKKEEPING, 0);
  advanceInterludeStepAndLiftKongFigure(m);
}

/** Twin (b): drops the 0x62AF clear (leaves the sentinel). Everything else faithful. */
function brokenNoClear(m) {
  const { regs, mem } = m;
  if (!tickSubstateTimer(m)) return;
  regs.hl = COPY_SOURCE;
  loadSpriteObjectBlock(m);
  mem.write8(STAMP_ADDR, 0x66);
  mem.write8(CLEAR_A, 0);
  mem.write8(CLEAR_B, 0);
  // BUG: no `ld (0x62af),0`.
  advanceInterludeStepAndLiftKongFigure(m);
}

/** Twin (c): inverts the gate polarity — runs the body while the timer is still ticking and
 *  skips it on expiry (docs/decompiler-pipeline's exact "reading it the other way inverts the routine" trap). */
function brokenGatePolarity(m) {
  const { regs, mem } = m;
  if (tickSubstateTimer(m)) return; // BUG: returns on expiry, runs while counting
  regs.hl = COPY_SOURCE;
  loadSpriteObjectBlock(m);
  mem.write8(STAMP_ADDR, 0x66);
  mem.write8(CLEAR_A, 0);
  mem.write8(CLEAR_B, 0);
  mem.write8(BOARD_BOOKKEEPING, 0);
  advanceInterludeStepAndLiftKongFigure(m);
}

test("TEETH (no-stamp): dropping the 0x690C re-stamp is CAUGHT and names 0x690C", () => {
  const [a, b] = craftPair(1, 0x01);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenNoStamp(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the sweep FAILED to catch a dropped re-stamp — it is worthless");
  assert.equal(bad.addr, STAMP_ADDR, `expected the caught diff at 0x690C, got ${hx(bad.addr)}`);
  console.log(`  TEETH/no-stamp: caught at 0x690C (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (no-clear): dropping the 0x62AF clear is CAUGHT and names 0x62AF", () => {
  const [a, b] = craftPair(1, 0x01);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenNoClear(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the sweep FAILED to catch a dropped clear — it is worthless");
  assert.equal(bad.addr, BOARD_BOOKKEEPING, `expected the caught diff at 0x62AF, got ${hx(bad.addr)}`);
  console.log(`  TEETH/no-clear: caught at 0x62AF (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (gate-polarity): inverting the timer gate is CAUGHT on the expiry arm", () => {
  const [a, b] = craftPair(1, 0x01);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenGatePolarity(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the sweep FAILED to catch an inverted gate polarity — it is worthless");
  console.log(`  TEETH/gate-polarity: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

// -- 5. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x168a dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(6000);

  for (const entry of caps) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `real-dispatch RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x168a dispatches in 6000 attract frames — it is a credited game's board-advance cutscene step (GAME_SUBSTATE 0x16); crafted sweeps are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x168a dispatch(es) — game-visible RAM identical to the oracle`);
  }
});

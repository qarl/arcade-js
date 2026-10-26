// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stageNextKongPoseWhenHoldExpires (ROM 0x1670) — one timer-gated step of the board-advance
 * render sequence (GAME_SUBSTATE 0x600A == 0x16, step selector 0x6388 == 1 on 25m/75m).
 *
 * stageNextKongPoseWhenHoldExpires WRITES memory and is NOT a leaf — it runs the rst-0x18 gate (tickSubstateTimer),
 * a block copy (loadSpriteObjectBlock), the rst-0x30 per-board gate (boardBitGate) and the
 * rst-0x38 Y-column nudge (addToSpriteObjectColumn) — so it is gated by capture / clone /
 * replay (docs/decompiler-pipeline) with a FRESH clone per case. Its logic has three inputs:
 *   - SUBSTATE_TIMER (0x6009) — the pose-hold gate; only the frame it decrements to 0 runs
 *     the body. Otherwise it just decrements and returns.
 *   - the 0x6388 step selector — the only input-dependent WRITE on the body (`inc`), the rest
 *     of the body being a deterministic copy that overwrites its own targets from ROM 0x3932.
 *   - BOARD (0x6227) — the rst-0x30 gate: A = 0x04 (mask bit2) opens the Y nudge on 75m only.
 *
 * A long attract run dispatches 0x1670 ZERO times (attract never completes a board, so it
 * never reaches GAME_SUBSTATE 0x16), so — exactly as docs/decompiler-pipeline prescribes for arms attract
 * never reaches — the gate is CRAFTED: a real booted attract machine, cloned, with the input
 * bytes surgically poked, then oracle-vs-idiomatic on independent fresh clones. The inputs are
 * small, so the crafted sweeps are EXHAUSTIVE:
 *
 *   1. STRUCTURE — a crafted 75m expiry entry (full path incl. the Y nudge): game-visible RAM
 *      identical, the oracle's salient outputs asserted (so EQUAL is not vacuous), the oracle's
 *      pushes land in STACK_SCRATCH (so excluding stack cannot mask a real diff), and the
 *      idiomatic side (direct calls, no stack) leaves SP/pc untouched. A gate-CLOSED entry
 *      (25m) confirms the Y column is NOT nudged; an ABORT entry (timer 5) confirms the clean
 *      rst-0x18 leaf just decrements 0x6009 and touches no SP/pc.
 *
 *   2. TIMER (exhaustive) — sweep SUBSTATE_TIMER 0..255 at 75m. Only value 1 expires (runs the
 *      full body incl. the +4 Y nudge and the 0x6388 inc); the other 255 merely count down.
 *      Both arms asserted, game-visible RAM identical over all.
 *
 *   3. STEP (exhaustive) — at expiry (timer 1) sweep the 0x6388 step byte 0..255. Pins the
 *      `inc` (result = (step+1)&0xFF, incl. the 0xFF->0x00 wrap) with the full work footprint
 *      identical each time.
 *
 *   4. BOARD (exhaustive) — at expiry sweep BOARD 0..255 through the rst-0x30 gate. Exactly
 *      the values with (BOARD-1)&7 == 2 (3, 11, 19, ...) open the Y nudge; all others close it.
 *      Game-visible RAM identical to the oracle for every board value, and the open/closed
 *      partition is asserted against the copied-vs-nudged Y column.
 *
 *   5. TEETH — two twins the sweeps MUST catch: (a) a WRONG-BOARD gate that applies the Y nudge
 *      unconditionally, caught on 25m (where the oracle skips it) naming the Y column 0x690b;
 *      (b) a dropped 0x6388 `inc`, caught by the step sweep naming 0x6388.
 *
 *   6. REALISM — hook 0x1670 over a long attract run; replay any real dispatch, else record
 *      that attract never reaches this interlude (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1670.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1670 as oracle } from "../../translated/loc_1670.js";
import { stageNextKongPoseWhenHoldExpires as idiomatic } from "../stageNextKongPoseWhenHoldExpires.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { boardBitGate } from "../boardBitGate.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SUBSTATE_TIMER, SPRITE_OBJ_BLOCK, BOARD } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1670;
const ANIM_FRAME_SRC = 0x3932; // ROM base of the copied 40-byte animation frame
const STEP_SELECTOR = 0x6388; // the board-advance step index (unnamed in names.js)
const Y_COLUMN = SPRITE_OBJ_BLOCK + 3; // 0x690b — field 3 (Y) of sprite-object record 0
const POSE_HOLD_FRAMES = 0x20;
const SP_CRAFT = 0x6bf8; // inside STACK_SCRATCH; headroom for the oracle's nested rst pushes/pops

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The oracle applies the +4 Y nudge only when (BOARD-1) mod 8 == 2 (rrca of A=0x04). BOARD 0
// rotates a full 256 turns and lands bit 7 of 0x04 = 0 (closed).
const gateOpens = (board) => board !== 0 && (((board - 1) & 7) === 2);

/**
 * First game-visible differing RAM byte between two machines, EXCLUDING the dead
 * stack-scratch region (the memory-equivalence contract is RAM − the stack scratch below the entry SP).
 */
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
// (cloned per case, never mutated). Genuine work RAM; only the three inputs move.
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

/** Two independent fresh clones of the base with identical input pokes (docs/decompiler-pipeline fresh clone
 *  per case — this routine writes RAM). Returns [oracleClone, candidateClone]. */
function craftPair(timer, board, step) {
  const a = base().clone(), b = base().clone();
  for (const m of [a, b]) {
    m.mem.write8(SUBSTATE_TIMER, timer);
    m.mem.write8(BOARD, board);
    m.mem.write8(STEP_SELECTOR, step);
    m.regs.sp = SP_CRAFT;
  }
  return [a, b];
}

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: 75m expiry — work RAM identical, salient outputs asserted, idiomatic touches no SP/pc", () => {
  // WORK + gate OPEN (75m): full body incl. the +4 Y nudge.
  const [a, b] = craftPair(1, 3, 1);
  const aFloor = a.regs.sp;
  const sp0 = b.regs.sp, pc0 = b.pc;
  oracle(a);
  idiomatic(b);
  const { bad, stackDiffs } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // The oracle actually did the work — confirm the salient outputs so EQUAL is not vacuous.
  assert.equal(a.mem.read8(SUBSTATE_TIMER), POSE_HOLD_FRAMES, "oracle must re-arm SUBSTATE_TIMER to 0x20 on expiry");
  assert.equal(a.mem.read8(STEP_SELECTOR), 2, "oracle must advance the 0x6388 step 1 -> 2 on expiry");
  assert.equal(a.mem.read8(SPRITE_OBJ_BLOCK), ROM[ANIM_FRAME_SRC],
    "oracle must copy record-0 field-0 from ROM 0x3932 into 0x6908");
  assert.equal(a.mem.read8(Y_COLUMN), (ROM[ANIM_FRAME_SRC + 3] + 4) & 0xff,
    "on 75m the copied Y column (0x690b) must be nudged +4");
  assert.ok(stackDiffs > 0, "the oracle's pushes must land in STACK_SCRATCH (so the exclusion is load-bearing)");
  assert.ok((SP_CRAFT - 4) >= STACK_SCRATCH.lo && (SP_CRAFT + 4) <= STACK_SCRATCH.hi,
    `oracle push / pop targets must stay inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);

  // The idiomatic side makes only direct calls — it models no stack and no return.
  assert.equal(b.regs.sp, sp0, "stageNextKongPoseWhenHoldExpires must leave SP unchanged (direct calls, no stack modelling)");
  assert.equal(b.pc, pc0, "stageNextKongPoseWhenHoldExpires must leave pc unchanged");

  // WORK + gate CLOSED (25m): the Y column is copied but NOT nudged.
  const [c, d] = craftPair(1, 1, 1);
  const cFloor = c.regs.sp;
  oracle(c);
  idiomatic(d);
  const closed = ramDiffMinusStack(c, d, cFloor);
  assert.equal(closed.bad, null, closed.bad && `25m RAM diff at ${hx(closed.bad.addr)}`);
  assert.equal(c.mem.read8(Y_COLUMN), ROM[ANIM_FRAME_SRC + 3],
    "on 25m the rst-0x30 gate is closed — the Y column must be the raw copied byte (no +4)");
  assert.equal(c.mem.read8(STEP_SELECTOR), 2, "the step still advances on 25m (only the Y nudge is board-gated)");

  // ABORT branch (timer 5): idiomatic takes only the clean rst-0x18 leaf.
  const e = base().clone();
  e.mem.write8(SUBSTATE_TIMER, 5); e.regs.sp = SP_CRAFT;
  const esp = e.regs.sp, epc = e.pc;
  idiomatic(e);
  assert.equal(e.regs.sp, esp, "abort branch must leave SP unchanged");
  assert.equal(e.pc, epc, "abort branch must leave pc unchanged");
  assert.equal(e.mem.read8(SUBSTATE_TIMER), 4, "abort branch must still decrement SUBSTATE_TIMER");
  console.log("  STRUCTURE: 75m work RAM identical (stackDiffs>0); 25m gate closed; abort touches no SP/pc");
});

// -- 2. TIMER (exhaustive) ----------------------------------------------------

test("TIMER (exhaustive): stageNextKongPoseWhenHoldExpires == oracle over all 256 SUBSTATE_TIMER values (75m)", () => {
  let count = 0, expired = 0, counting = 0, mismatch = null;
  for (let t = 0; t < 256 && !mismatch; t++) {
    const [a, b] = craftPair(t, 3, 1);
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    // Expiry advances the step selector (1 -> 2); counting leaves it at 1.
    if (a.mem.read8(STEP_SELECTOR) !== 1) expired++; else counting++;
    if (bad) mismatch = { t, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at SUBSTATE_TIMER=${hx(mismatch.t)}: RAM diff at ` +
      `${hx(mismatch.bad.addr)} (oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 timer values");
  assert.equal(expired, 1, "exactly one value (1) must expire and run the body");
  assert.equal(counting, 255, "the other 255 values must merely count down");
  console.log("  TIMER/exhaustive: 256 values — game-visible RAM identical (1 expiry, 255 counting)");
});

// -- 3. STEP (exhaustive) -----------------------------------------------------

test("STEP (exhaustive): at expiry, stageNextKongPoseWhenHoldExpires == oracle over all 256 step bytes", () => {
  let count = 0, wraps = 0, mismatch = null;
  for (let s = 0; s < 256 && !mismatch; s++) {
    const [a, b] = craftPair(1, 3, s); // timer 1 forces the `inc (0x6388)` path
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    assert.equal(a.mem.read8(STEP_SELECTOR), (s + 1) & 0xff,
      `oracle must set 0x6388 to (step+1)&0xFF at step=${hx(s)}`);
    if (s === 0xff && a.mem.read8(STEP_SELECTOR) === 0x00) wraps++;
    if (bad) mismatch = { s, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at step=${hx(mismatch.s)}: RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 step values");
  assert.equal(wraps, 1, "the 0xFF -> 0x00 wrap must have been exercised");
  console.log("  STEP/exhaustive: 256 values — full work footprint identical (incl. 0xFF->0x00 wrap)");
});

// -- 4. BOARD (exhaustive) ----------------------------------------------------

test("BOARD (exhaustive): at expiry, stageNextKongPoseWhenHoldExpires == oracle through the rst-0x30 gate over all 256 boards", () => {
  let count = 0, opens = 0, closes = 0, mismatch = null, partition = null;
  for (let board = 0; board < 256 && !mismatch; board++) {
    const [a, b] = craftPair(1, board, 1);
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    // Cross-check the oracle's gate decision against the copied-vs-nudged Y column.
    const nudged = a.mem.read8(Y_COLUMN) === ((ROM[ANIM_FRAME_SRC + 3] + 4) & 0xff);
    const raw = a.mem.read8(Y_COLUMN) === ROM[ANIM_FRAME_SRC + 3];
    if (nudged && gateOpens(board)) opens++;
    else if (raw && !gateOpens(board)) closes++;
    else if (!partition) partition = { board, y: a.mem.read8(Y_COLUMN) };
    if (bad) mismatch = { board, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at BOARD=${hx(mismatch.board)}: RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(partition, null,
    partition && `oracle gate decision disagreed with gateOpens() at BOARD=${hx(partition.board)} (Y=${hx(partition.y)})`);
  assert.equal(count, 256, "must have swept all 256 board values");
  assert.equal(opens, 32, "exactly the 32 boards with (BOARD-1)&7==2 must open the Y nudge");
  assert.equal(closes, 224, "the other 224 boards must close the gate");
  console.log(`  BOARD/exhaustive: 256 boards — RAM identical; ${opens} open the Y nudge, ${closes} close it`);
});

// -- 5. TEETH -----------------------------------------------------------------

/** Twin (a): applies the Y nudge UNCONDITIONALLY (drops the rst-0x30 board gate). Faithful
 *  otherwise, so on a closed-gate board (25m) the ONLY divergence is the Y column. */
function brokenWrongBoardGate(m) {
  const { regs, mem } = m;
  if (!tickSubstateTimer(m)) return;
  regs.hl = ANIM_FRAME_SRC; loadSpriteObjectBlock(m);
  mem.write8(SUBSTATE_TIMER, POSE_HOLD_FRAMES);
  mem.write8(STEP_SELECTOR, (mem.read8(STEP_SELECTOR) + 1) & 0xff);
  regs.a = 0x04;
  // BUG: no board gate — nudge on every board.
  regs.hl = Y_COLUMN; regs.c = 0x04; addToSpriteObjectColumn(m);
}

/** Twin (b): faithful but DROPS the `inc (0x6388)`, so at expiry the step stays at its input
 *  where the oracle advances it. */
function brokenNoAdvance(m) {
  const { regs, mem } = m;
  if (!tickSubstateTimer(m)) return;
  regs.hl = ANIM_FRAME_SRC; loadSpriteObjectBlock(m);
  mem.write8(SUBSTATE_TIMER, POSE_HOLD_FRAMES);
  // BUG: no 0x6388 advance.
  regs.a = 0x04;
  if (!boardBitGate(m)) return;
  regs.hl = Y_COLUMN; regs.c = 0x04; addToSpriteObjectColumn(m);
}

test("TEETH (wrong-board gate): nudging the Y column on 25m is CAUGHT and names 0x690b", () => {
  const [a, b] = craftPair(1, 1, 1); // 25m — the oracle's gate is CLOSED here
  const aFloor = a.regs.sp;
  oracle(a);
  brokenWrongBoardGate(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the crafted sweep FAILED to catch a wrong board gate — it is worthless");
  assert.equal(bad.addr, Y_COLUMN, `expected the caught diff at 0x690b, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-board: caught at 0x690b (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (drop-advance): the dropped 0x6388 inc is CAUGHT by the step sweep and names 0x6388", () => {
  let caught = null;
  for (let s = 0; s < 256 && !caught; s++) {
    const [a, b] = craftPair(1, 1, s);
    const aFloor = a.regs.sp;
    oracle(a);
    brokenNoAdvance(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad) caught = { s, bad };
  }
  assert.notEqual(caught, null, "the step sweep FAILED to catch a dropped advance — it is worthless");
  assert.equal(caught.bad.addr, STEP_SELECTOR, `expected the caught diff at 0x6388, got ${hx(caught.bad.addr)}`);
  console.log(`  TEETH/drop-advance: caught at step=${hx(caught.s)} (0x6388 oracle=${caught.bad.a} broken=${caught.bad.b})`);
});

// -- 6. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x1670 dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(8000);

  for (const entry of caps) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `real-dispatch RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x1670 dispatches in 8000 attract frames — attract never completes a board (GAME_SUBSTATE 0x16); crafted sweeps are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x1670 dispatch(es) — game-visible RAM identical to the oracle`);
  }
});

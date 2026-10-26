// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for beginKongRecaptureInterlude (ROM 0x1654) — step 0 of the board-advance render
 * sequence (GAME_SUBSTATE 0x600A == 0x16, step selector 0x6388 == 0 on 25m/75m): run the
 * intro/board spawn init, stage the first sprite-object animation frame from ROM 0x385C,
 * arm the pose-hold timer, then fall through the shared tail (advanceInterludeStepAndLiftKongFigure).
 *
 * beginKongRecaptureInterlude WRITES memory and is NOT a leaf — it runs spawnInterludeHeart (the spawn init, ROM
 * 0x1708), a block copy (loadSpriteObjectBlock, ROM 0x004e) and the shared tail advanceInterludeStepAndLiftKongFigure
 * (ROM 0x1662, itself the rst-0x30 board gate + rst-0x38 Y-column subtract) — so it is
 * gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per case. Every step is
 * deterministic given the ROM: spawnInterludeHeart is input-independent, the copy reads a fixed ROM
 * template, and SUBSTATE_TIMER := 0x20 is constant. The routine's ONLY input-dependent
 * branch is the tail's rst-0x30 board gate (A = 1 = bit0), which subtracts 4 from the ten
 * records' Y column on 25m only.
 *
 * A long attract run dispatches 0x1654 ZERO times (attract never completes a board, so it
 * never reaches GAME_SUBSTATE 0x16), so — exactly as docs/decompiler-pipeline prescribes for arms attract
 * never reaches — the gate is CRAFTED: a real booted attract machine, cloned, with the
 * inputs surgically poked, then oracle-vs-idiomatic on independent fresh clones. The one
 * branch input is a single byte, so the crafted sweep is EXHAUSTIVE over it:
 *
 *   1. STRUCTURE — a crafted 25m entry (BOARD=1, gate OPEN, full path incl. the -4 Y
 *      nudge): game-visible RAM identical; the oracle's salient outputs asserted (spawn
 *      markers, the ROM 0x385C copy, SUBSTATE_TIMER := 0x20, the 0x6388 inc, the -4 Y
 *      column) so EQUAL is not vacuous; the oracle's pushes land in STACK_SCRATCH (so
 *      excluding stack cannot mask a real diff); the idiomatic side (direct calls, no
 *      stack) leaves SP/pc untouched. A gate-CLOSED entry (BOARD=2) confirms the Y column
 *      is the raw copied ROM byte (no -4) while the step still advances.
 *
 *   2. BOARD (exhaustive) — sweep BOARD 0..255 through the rst-0x30 gate. Exactly the 32
 *      values ≡ 1 (mod 8) open the -4 Y nudge; the other 224 (incl. BOARD=0) skip it.
 *      Game-visible RAM identical to the oracle for every board value, and the open/closed
 *      partition is asserted against the copied-vs-nudged Y column AND gateOpens().
 *
 *   3. STEP (wrap) — seed the 0x6388 step byte across values incl. 0xFF; on the taken arm
 *      confirm oracle == idiomatic AND 0x6388 becomes (step+1)&0xFF (incl. 0xFF→0x00).
 *
 *   4. TEETH — two twins the sweeps MUST catch: (a) a WRONG-BOARD gate that applies the -4
 *      subtract unconditionally, caught on a skip board (BOARD=2) in the Y/strided column;
 *      (b) a dropped 0x6388 inc, caught on any arm naming 0x6388.
 *
 *   5. REALISM — hook 0x1654 over a long attract run; replay any real dispatch, else record
 *      that attract never reaches this interlude (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1654.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1654 as oracle } from "../../translated/loc_1654.js";
import { beginKongRecaptureInterlude as idiomatic } from "../beginKongRecaptureInterlude.js";
import { spawnInterludeHeart } from "../spawnInterludeHeart.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { boardBitGate } from "../boardBitGate.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SUBSTATE_TIMER, SPRITE_OBJ_BLOCK, BOARD, SND_PRIORITY } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1654;
const ANIM_FRAME_SRC = 0x385c; // ROM base of the copied 40-byte animation frame
const STEP_SELECTOR = 0x6388; // the board-advance step index (unnamed in names.js)
const Y_COLUMN = SPRITE_OBJ_BLOCK + 3; // 0x690b — field 3 (Y) of sprite-object record 0
// The rst-0x38 targets: field 3 (+3) of each of the ten 4-byte sprite-object records.
const STRIDED = Array.from({ length: 10 }, (_, k) => SPRITE_OBJ_BLOCK + 3 + 4 * k); // 0x690B..0x692F
const POSE_HOLD_FRAMES = 0x20;
// Spawn-init markers spawnInterludeHeart writes (constants) — used to prove the spawn init ran.
const SPRITE_RECORD_6A20 = 0x6a20; // seeded to 0x80
const BLINK_SPRITE_CODE = 0x6905; // seeded to 0x13
const SP_CRAFT = 0x6bf8; // inside STACK_SCRATCH; headroom for the oracle's nested rst/call pushes

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The oracle's tail applies the -4 Y subtract only when boardBitGate(A=1) reports bit0 set:
// carry after `rrca × BOARD` holds bit (BOARD-1) of A=1, so it opens iff (BOARD-1)&7 == 0
// (boards 1, 9, 17, …, 249). BOARD=0 rotates a full turn and lands bit 7 = 0 (closed);
// ((0-1)&7)===7 already classifies it closed.
const gateOpens = (board) => ((board - 1) & 7) === 0;

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
// (cloned per case, never mutated). Genuine work RAM; only the inputs move.
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
 *  per case — this routine writes RAM). `step`, if given, seeds the 0x6388 selector.
 *  Returns [oracleClone, candidateClone]. */
function craftPair(board, step) {
  const a = base().clone(), b = base().clone();
  for (const m of [a, b]) {
    m.mem.write8(BOARD, board);
    if (step !== undefined) m.mem.write8(STEP_SELECTOR, step);
    m.regs.sp = SP_CRAFT;
  }
  return [a, b];
}

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: 25m — work RAM identical, salient outputs asserted, idiomatic touches no SP/pc", () => {
  // Gate OPEN (BOARD=1): full path incl. the -4 Y nudge.
  const [a, b] = craftPair(1, 0x40);
  const aFloor = a.regs.sp;
  const inc0 = a.mem.read8(STEP_SELECTOR);
  const sp0 = b.regs.sp, pc0 = b.pc;
  oracle(a);
  idiomatic(b);
  const { bad, stackDiffs } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // The oracle actually did the work — confirm salient outputs so EQUAL is not vacuous.
  assert.equal(a.mem.read8(SPRITE_RECORD_6A20), 0x80, "spawn init (spawnInterludeHeart) must seed 0x6A20 = 0x80");
  assert.equal(a.mem.read8(BLINK_SPRITE_CODE), 0x13, "spawn init must seed the blink code 0x6905 = 0x13");
  assert.equal(a.mem.read8(SND_PRIORITY), 0x07, "spawn init must set SND_PRIORITY (0x608A) = 0x07");
  assert.equal(a.mem.read8(SPRITE_OBJ_BLOCK), ROM[ANIM_FRAME_SRC],
    "must copy record-0 field-0 from ROM 0x385C into 0x6908");
  assert.equal(a.mem.read8(SUBSTATE_TIMER), POSE_HOLD_FRAMES, "must arm SUBSTATE_TIMER to 0x20");
  assert.equal(a.mem.read8(STEP_SELECTOR), (inc0 + 1) & 0xff, "shared tail must inc the 0x6388 step selector");
  assert.equal(a.mem.read8(Y_COLUMN), (ROM[ANIM_FRAME_SRC + 3] - 4) & 0xff,
    "on 25m the copied Y column (0x690b) must be nudged -4");
  assert.ok(stackDiffs > 0, "the oracle's pushes must land in STACK_SCRATCH (so the exclusion is load-bearing)");
  assert.ok((SP_CRAFT - 4) >= STACK_SCRATCH.lo && (SP_CRAFT + 4) <= STACK_SCRATCH.hi,
    `oracle push / pop targets must stay inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);

  // The idiomatic side makes only direct calls — it models no stack and no return.
  assert.equal(b.regs.sp, sp0, "beginKongRecaptureInterlude must leave SP unchanged (direct calls, no stack modelling)");
  assert.equal(b.pc, pc0, "beginKongRecaptureInterlude must leave pc unchanged");

  // Gate CLOSED (BOARD=2): the Y column is copied but NOT nudged; the step still advances.
  const [c, d] = craftPair(2, 0x40);
  const cFloor = c.regs.sp;
  const inc1 = c.mem.read8(STEP_SELECTOR);
  oracle(c);
  idiomatic(d);
  const closed = ramDiffMinusStack(c, d, cFloor);
  assert.equal(closed.bad, null, closed.bad && `50m RAM diff at ${hx(closed.bad.addr)}`);
  assert.equal(c.mem.read8(Y_COLUMN), ROM[ANIM_FRAME_SRC + 3],
    "on a non-25m board the rst-0x30 gate is closed — the Y column must be the raw copied byte (no -4)");
  assert.equal(c.mem.read8(STEP_SELECTOR), (inc1 + 1) & 0xff, "the step still advances (only the Y nudge is board-gated)");
  console.log("  STRUCTURE: 25m work RAM identical (stackDiffs>0); non-25m gate closed; idiomatic touches no SP/pc");
});

// -- 2. BOARD (exhaustive) ----------------------------------------------------

test("BOARD (exhaustive): beginKongRecaptureInterlude == oracle through the rst-0x30 gate over all 256 boards", () => {
  let count = 0, opens = 0, closes = 0, mismatch = null, partition = null;
  const raw = ROM[ANIM_FRAME_SRC + 3];
  const nudgedVal = (raw - 4) & 0xff;
  for (let board = 0; board < 256 && !mismatch; board++) {
    const [a, b] = craftPair(board, 0x40);
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    // Cross-check the oracle's gate decision against the copied-vs-nudged Y column.
    const nudged = a.mem.read8(Y_COLUMN) === nudgedVal;
    const untouched = a.mem.read8(Y_COLUMN) === raw;
    if (nudged && gateOpens(board)) opens++;
    else if (untouched && !gateOpens(board)) closes++;
    else if (!partition) partition = { board, y: a.mem.read8(Y_COLUMN) };
    if (bad) mismatch = { board, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at BOARD=${hx(mismatch.board)}: RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(partition, null,
    partition && `oracle gate decision disagreed with gateOpens() at BOARD=${hx(partition.board)} (Y=${hx(partition.y)})`);
  assert.equal(count, 256, "must have swept all 256 board values");
  assert.equal(opens, 32, "exactly the 32 boards ≡ 1 (mod 8) must open the -4 Y nudge");
  assert.equal(closes, 224, "the other 224 boards must close the gate");
  console.log(`  BOARD/exhaustive: 256 boards — RAM identical; ${opens} open the -4 nudge, ${closes} close it`);
});

// -- 3. STEP (wrap) -----------------------------------------------------------

test("STEP (wrap): beginKongRecaptureInterlude == oracle over seeded 0x6388 values incl. the 0xFF→0x00 wrap", () => {
  let wraps = 0, mismatch = null;
  for (const s of [0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff]) {
    const [a, b] = craftPair(1, s); // BOARD=1 so the full tail runs
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(a.mem.read8(STEP_SELECTOR), (s + 1) & 0xff,
      `oracle must set 0x6388 to (step+1)&0xFF at step=${hx(s)}`);
    if (s === 0xff && a.mem.read8(STEP_SELECTOR) === 0x00) wraps++;
    if (bad) { mismatch = { s, bad }; break; }
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at step=${hx(mismatch.s)}: RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(wraps, 1, "the 0xFF → 0x00 step wrap must have been exercised");
  console.log("  STEP/wrap: seeded 0x6388 values — RAM identical (incl. 0xFF→0x00 wrap)");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): applies the -4 Y subtract UNCONDITIONALLY (drops the rst-0x30 board gate).
 *  Faithful otherwise, so on a closed-gate board (BOARD=2) the ONLY divergence is the Y
 *  column (the strided block from 0x690b). */
function brokenUnconditionalGate(m) {
  const { regs, mem } = m;
  spawnInterludeHeart(m);
  regs.hl = ANIM_FRAME_SRC; loadSpriteObjectBlock(m);
  mem.write8(SUBSTATE_TIMER, POSE_HOLD_FRAMES);
  // shared tail, but ignore the gate verdict.
  mem.write8(STEP_SELECTOR, (mem.read8(STEP_SELECTOR) + 1) & 0xff);
  regs.a = 0x01;
  boardBitGate(m); // still consult the gate, but ignore its verdict
  regs.hl = SPRITE_OBJ_BLOCK + 3; regs.c = 0xfc; addToSpriteObjectColumn(m);
}

/** Twin (b): faithful but DROPS the `inc (0x6388)`, so the step stays at its seeded input
 *  where the oracle advances it. */
function brokenNoInc(m) {
  const { regs, mem } = m;
  spawnInterludeHeart(m);
  regs.hl = ANIM_FRAME_SRC; loadSpriteObjectBlock(m);
  mem.write8(SUBSTATE_TIMER, POSE_HOLD_FRAMES);
  // BUG: no 0x6388 advance.
  regs.a = 0x01;
  if (!boardBitGate(m)) return;
  regs.hl = SPRITE_OBJ_BLOCK + 3; regs.c = 0xfc; addToSpriteObjectColumn(m);
}

test("TEETH (unconditional gate): subtracting on a skip board (BOARD=2) is CAUGHT in the strided block", () => {
  const [a, b] = craftPair(2, 0x40); // non-25m — the oracle's gate is CLOSED here
  const aFloor = a.regs.sp;
  oracle(a);
  brokenUnconditionalGate(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the crafted sweep FAILED to catch an ungated subtract — it is worthless");
  assert.ok(STRIDED.includes(bad.addr), `expected the caught diff in the strided block, got ${hx(bad.addr)}`);
  console.log(`  TEETH/unconditional: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (no-inc): dropping the 0x6388 inc is CAUGHT and names 0x6388", () => {
  const [a, b] = craftPair(1, 0x40);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenNoInc(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the crafted sweep FAILED to catch a dropped inc — it is worthless");
  assert.equal(bad.addr, STEP_SELECTOR, `expected the caught diff at 0x6388, got ${hx(bad.addr)}`);
  console.log(`  TEETH/no-inc: caught at 0x6388 (oracle=${bad.a} broken=${bad.b})`);
});

// -- 5. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x1654 dispatch; else record that attract never reaches it", () => {
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
    console.log("  REALISM: 0 real 0x1654 dispatches in 8000 attract frames — attract never completes a board (GAME_SUBSTATE 0x16); crafted sweeps are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x1654 dispatch(es) — game-visible RAM identical to the oracle`);
  }
});

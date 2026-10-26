// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advanceInterludeStepAndLiftKongFigure (ROM 0x1662) — the shared board-setup tail:
 * bump the 0x6388 animation counter, then (only on the 25m board, via the rst-0x30
 * gate) subtract 4 from field 3 of every sprite-object record (rst 0x38).
 *
 * advanceInterludeStepAndLiftKongFigure WRITES memory and is NOT a leaf — it runs the idiomatic leaves boardBitGate
 * (rst 0x30 board gate, ROM 0x0030) and addToSpriteObjectColumn (rst 0x38 strided add,
 * ROM 0x0038) — so it is gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone
 * per case. boardBitGate is itself memory-equivalent to the oracle's gate, so advanceInterludeStepAndLiftKongFigure's
 * branch decision tracks the oracle; what this test pins is that advanceInterludeStepAndLiftKongFigure (a) does the
 * inc, (b) gates the subtract on that decision, and (c) sets up and runs the subtract on
 * the taken arm — with the twins proving the sweep bites.
 *
 * A 6000-frame attract run dispatches 0x1662 ZERO times (it is a credited game's
 * board-setup tail, reached only through the 0x1644-index handlers beginKongRecaptureInterlude/stageKongClimbPose),
 * so — exactly as docs/decompiler-pipeline prescribes for arms attract never reaches — the gate is
 * CRAFTED: a real booted attract machine, cloned, with BOARD (0x6227) surgically
 * poked, then oracle-vs-idiomatic on independent fresh clones. The one input that
 * selects the branch is a single byte, so the crafted sweep is EXHAUSTIVE over it:
 *
 *   1. STRUCTURE — normal arm (BOARD=1): game-visible RAM identical; the body did
 *      real work (0x6388++ and each strided byte -=4); the oracle's pushes land in
 *      STACK_SCRATCH (so excluding stack cannot mask a real diff). Skip arm (BOARD=2):
 *      RAM identical, the strided block is UNTOUCHED, only 0x6388 advanced.
 *
 *   2. BOARD (exhaustive) — sweep BOARD 0..255. advanceInterludeStepAndLiftKongFigure == oracle on game-visible
 *      RAM for every value; exactly the 32 values ≡ 1 (mod 8) take the subtract arm,
 *      the other 224 skip — pinning the gate branch across every possible board byte.
 *
 *   3. SUBTRACT (wrap) — on the taken arm, seed the ten strided bytes to a pattern
 *      that forces the 8-bit wrap (0x00-4 -> 0xFC ...); confirm oracle == idiomatic
 *      AND that each target became (seed-4)&0xFF, pinning the -4 magnitude.
 *
 *   4. TEETH — three twins the sweeps MUST catch: (a) runs the subtract
 *      UNCONDITIONALLY (ignores the gate) — caught on the skip arm; (b) drops the
 *      0x6388 inc — caught on any arm at 0x6388; (c) subtracts 5 (C=0xFB) instead of
 *      4 — caught on the taken arm in the strided block.
 *
 *   5. REALISM — hook 0x1662 over a long attract run; replay any real dispatch if one
 *      occurs, else record that attract never reaches it (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1662.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1662 as oracle } from "../../translated/loc_1662.js";
import { advanceInterludeStepAndLiftKongFigure as idiomatic } from "../advanceInterludeStepAndLiftKongFigure.js";
import { boardBitGate } from "../boardBitGate.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SPRITE_OBJ_BLOCK, BOARD } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1662;
const ANIM_SCRATCH = 0x6388;
// The rst-0x38 targets: field 3 (+3) of each of the ten 4-byte sprite-object records.
const STRIDED = Array.from({ length: 10 }, (_, k) => SPRITE_OBJ_BLOCK + 3 + 4 * k); // 0x690B..0x692F
// SP inside STACK_SCRATCH with headroom for the oracle's pushes (down to SP-2) AND
// the idiomatic side's unmatched callee pops (up to SP+4).
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

// A real booted attract machine, built once and reused as the base for every crafted
// entry (cloned per case, never mutated). Genuine work RAM; only the inputs move.
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

/** Poke the ten strided bytes identically (used where the subtract must be observable). */
function seedStrided(m, seeds) {
  for (let k = 0; k < STRIDED.length; k++) m.mem.write8(STRIDED[k], seeds[k]);
}

/**
 * Two independent fresh clones of the base (docs/decompiler-pipeline fresh clone per case — this
 * routine writes RAM), each with BOARD poked and SP planted in STACK_SCRATCH.
 * `seeds`, if given, primes the strided block identically on both. Returns
 * [oracleClone, candidateClone].
 */
function craftPair(board, seeds) {
  const a = base().clone(), b = base().clone();
  for (const m of [a, b]) {
    m.mem.write8(BOARD, board);
    m.regs.sp = SP_CRAFT;
    if (seeds) seedStrided(m, seeds);
  }
  return [a, b];
}

// A seed pattern for the strided block that forces the 8-bit wrap on the -4 subtract.
const WRAP_SEEDS = [0x00, 0x01, 0x02, 0x03, 0x80, 0x81, 0x7f, 0xfc, 0xfe, 0xff];

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: normal arm (BOARD=1) does the work; skip arm (BOARD=2) leaves the block untouched", () => {
  // Normal arm — BOARD=1 sets the gate carry, so the strided subtract runs.
  const [a, b] = craftPair(1, WRAP_SEEDS);
  const aFloor = a.regs.sp;
  const inc0 = a.mem.read8(ANIM_SCRATCH);
  oracle(a);
  idiomatic(b);
  const { bad, stackDiffs } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // Non-vacuous: the body actually did something on the oracle side.
  assert.equal(a.mem.read8(ANIM_SCRATCH), (inc0 + 1) & 0xff, "oracle must inc the 0x6388 counter");
  for (let k = 0; k < STRIDED.length; k++) {
    assert.equal(a.mem.read8(STRIDED[k]), (WRAP_SEEDS[k] - 4) & 0xff,
      `oracle must subtract 4 (with wrap) from ${hx(STRIDED[k])}`);
  }
  assert.ok(stackDiffs > 0, "the oracle's pushes must land in STACK_SCRATCH (so the exclusion is load-bearing)");
  assert.ok((SP_CRAFT - 2) >= STACK_SCRATCH.lo && (SP_CRAFT + 4) <= STACK_SCRATCH.hi,
    `oracle push / idiomatic pop targets must stay inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);

  // Skip arm — BOARD=2 clears the gate carry, so the strided subtract must NOT run.
  const [c, d] = craftPair(2, WRAP_SEEDS);
  const cFloor = c.regs.sp;
  const inc1 = c.mem.read8(ANIM_SCRATCH);
  oracle(c);
  idiomatic(d);
  const skip = ramDiffMinusStack(c, d, cFloor);
  assert.equal(skip.bad, null, skip.bad && `skip-arm RAM diff at ${hx(skip.bad.addr)} (oracle=${skip.bad.a} idiomatic=${skip.bad.b})`);
  assert.equal(c.mem.read8(ANIM_SCRATCH), (inc1 + 1) & 0xff, "skip arm must still inc 0x6388");
  for (let k = 0; k < STRIDED.length; k++) {
    assert.equal(c.mem.read8(STRIDED[k]), WRAP_SEEDS[k],
      `skip arm must leave ${hx(STRIDED[k])} untouched`);
  }
  console.log("  STRUCTURE: normal arm subtracts (stackDiffs>0); skip arm leaves the strided block untouched");
});

// -- 2. BOARD (exhaustive) ----------------------------------------------------

test("BOARD (exhaustive): advanceInterludeStepAndLiftKongFigure == oracle over all 256 BOARD values (gate branch pinned)", () => {
  let count = 0, took = 0, skipped = 0, mismatch = null;
  for (let board = 0; board < 256 && !mismatch; board++) {
    const [a, b] = craftPair(board, WRAP_SEEDS);
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    // Classify from the oracle: the subtract arm changes the strided block.
    if (a.mem.read8(STRIDED[0]) !== WRAP_SEEDS[0]) took++; else skipped++;
    if (bad) mismatch = { board, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at BOARD=${hx(mismatch.board)}: RAM diff at ` +
      `${hx(mismatch.bad.addr)} (oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 BOARD values");
  assert.equal(took, 32, "exactly the 32 boards ≡ 1 (mod 8) must take the subtract arm");
  assert.equal(skipped, 224, "the other 224 boards must skip the subtract");
  console.log(`  BOARD/exhaustive: 256 values — RAM identical (32 subtract, 224 skip)`);
});

// -- 3. SUBTRACT (wrap) -------------------------------------------------------

test("SUBTRACT (wrap): on the taken arm the strided -4 wraps 8-bit, oracle == idiomatic", () => {
  const [a, b] = craftPair(1, WRAP_SEEDS);
  const aFloor = a.regs.sp;
  oracle(a);
  idiomatic(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  // Pin the exact -4 result on both sides, including the 0x00->0xFC / 0x03->0xFF wrap.
  for (let k = 0; k < STRIDED.length; k++) {
    const want = (WRAP_SEEDS[k] - 4) & 0xff;
    assert.equal(a.mem.read8(STRIDED[k]), want, `oracle ${hx(STRIDED[k])}`);
    assert.equal(b.mem.read8(STRIDED[k]), want, `idiomatic ${hx(STRIDED[k])}`);
  }
  console.log("  SUBTRACT/wrap: all ten strided bytes = (seed-4)&0xFF on both sides");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): runs the rst-0x38 subtract UNCONDITIONALLY, ignoring the board gate.
 *  Faithful everywhere except it subtracts on boards that should skip. */
function brokenUnconditional(m) {
  const { regs, mem } = m;
  mem.write8(ANIM_SCRATCH, (mem.read8(ANIM_SCRATCH) + 1) & 0xff);
  regs.a = 0x01;
  boardBitGate(m); // still consult the gate, but ignore its verdict
  regs.hl = SPRITE_OBJ_BLOCK + 3;
  regs.c = 0xfc;
  addToSpriteObjectColumn(m);
}

/** Twin (b): drops the 0x6388 inc. Everything else faithful. */
function brokenNoInc(m) {
  const { regs } = m;
  regs.a = 0x01;
  if (!boardBitGate(m)) return;
  regs.hl = SPRITE_OBJ_BLOCK + 3;
  regs.c = 0xfc;
  addToSpriteObjectColumn(m);
}

/** Twin (c): subtracts 5 (C=0xFB) instead of 4 on the taken arm. */
function brokenWrongStep(m) {
  const { regs, mem } = m;
  mem.write8(ANIM_SCRATCH, (mem.read8(ANIM_SCRATCH) + 1) & 0xff);
  regs.a = 0x01;
  if (!boardBitGate(m)) return;
  regs.hl = SPRITE_OBJ_BLOCK + 3;
  regs.c = 0xfb; // BUG: -5, not -4
  addToSpriteObjectColumn(m);
}

test("TEETH (unconditional): subtracting on a skip board (BOARD=2) is CAUGHT in the strided block", () => {
  const [a, b] = craftPair(2, WRAP_SEEDS);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenUnconditional(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the sweep FAILED to catch an ungated subtract — it is worthless");
  assert.ok(STRIDED.includes(bad.addr), `expected the caught diff in the strided block, got ${hx(bad.addr)}`);
  console.log(`  TEETH/unconditional: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (no-inc): dropping the 0x6388 inc is CAUGHT and names 0x6388", () => {
  const [a, b] = craftPair(1, WRAP_SEEDS);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenNoInc(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the sweep FAILED to catch a dropped inc — it is worthless");
  assert.equal(bad.addr, ANIM_SCRATCH, `expected the caught diff at 0x6388, got ${hx(bad.addr)}`);
  console.log(`  TEETH/no-inc: caught at 0x6388 (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (wrong-step): subtracting 5 instead of 4 is CAUGHT in the strided block", () => {
  const [a, b] = craftPair(1, WRAP_SEEDS);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenWrongStep(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the sweep FAILED to catch a wrong subtract magnitude — it is worthless");
  assert.ok(STRIDED.includes(bad.addr), `expected the caught diff in the strided block, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-step: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

// -- 5. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x1662 dispatch; else record that attract never reaches it", () => {
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
    console.log("  REALISM: 0 real 0x1662 dispatches in 6000 attract frames — it is a credited game's board-setup tail (via beginKongRecaptureInterlude/stageKongClimbPose); crafted sweeps are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x1662 dispatch(es) — game-visible RAM identical to the oracle`);
  }
});

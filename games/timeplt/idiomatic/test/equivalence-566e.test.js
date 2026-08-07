// SPDX-License-Identifier: GPL-3.0-only
/**
 * requestTwoSoundsWhilePlaying — memory-equivalent to the frozen oracle at ROM 0x566E.
 *
 * WHAT IT IS. Four instructions: fetch a byte of the program image into the accumulator, call the
 * shared sound-request body at ROM 0x560C, fetch a second image byte, and transfer to that same
 * body again. The second fetch and its transfer ARE the routine registered at ROM 0x5674, which
 * the frozen layer transcribes a second time inside this file; both 0x560C and 0x5674 are already
 * decompiled, so the rewrite calls them directly and this file holds no copy of either.
 *
 * THE ENTRY BUDGET IS NOT THE SHARED ONE, and that is a measurement. The shared coin -> start tape
 *   does not reach this address at all in 6000 frames; the undriven attract tape reaches it once,
 *   at frame 5313, so this file runs attract to 5400 and caches that one entry.
 *
 * GATE: unit-capture at that real dispatch with an eight-byte scratch exclusion, plus crafted
 *   sweeps over the permission cell and the whole queue length, plus a poked-image arm. What it
 *   exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch, outside the scratch window.
 *   2. THE ONE REAL DISPATCH IS ON THE DROP PATH AND WRITES NOTHING. Measured: the play-active
 *      flag reads zero when it is entered, so both requests are refused and the only cells that
 *      move are dead stack. Asserted, because a gate whose single real entry writes nothing must
 *      say so rather than let "EQUAL at the real dispatch" read as coverage.
 *   3. THE DEAD STACK SCRATCH IS THE ONE EXCLUSION, pinned to [SP-8, SP): the two nested request
 *      bodies' pushed pairs and the restart address the enqueue pushes. Measured at eight on the
 *      admitting path and six on the refusing one, so eight is an upper bound and every arm
 *      asserts that nothing escapes it.
 *   4. THE TWO CODES IT ASKS FOR, and their ORDER, read back out of the queue the oracle wrote.
 *   5. IT READS THE IMAGE — the first code follows a poked source byte, and a twin that carries
 *      that code as an immediate is asserted INVISIBLE without the poke and caught with it.
 *   6. THE PERMISSION CELL swept, which is the only coverage of the admitting branch.
 *   7. EXHAUSTIVE over the queue length, 0..255, which is where the length's byte wrap lives.
 *   8. TEETH — six twins.
 *
 * HOLE: REGISTERS ARE EXCLUDED AND THE ACCUMULATOR IS AMONG THEM. The oracle leaves it holding
 * the second code; the rewrite passes both codes as arguments and never assigns it. Nothing here
 * watches a caller read it, so this is a deliberate drop and not a measured dead value.
 *
 * HOLE: WHAT the two sounds are. Nothing on this CPU can say; the codes are bytes handed to a
 * second processor. This gate fixes which bytes, in which order, and under what permission.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-566e.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import {
  QUEUE_LENGTH,
  allDiffs,
  hex4,
  oracleAt,
  realDiff,
  show,
  withPokedImage,
} from "./_soundQueue.js";
import { requestTwoSoundsWhilePlaying } from "../requestTwoSoundsWhilePlaying.js";
import { loc_560c } from "../loc_560c.js";
import { loc_562a } from "../loc_562a.js";
import { PLAY_ACTIVE } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x566e;
const FIRST_CODE_CELL = 0x07d8;
const SECOND_CODE_CELL = 0x276b;
const FIRST_CODE = 6;
const SECOND_CODE = 4;
const POKED_CODE = 0x5e;
const SCRATCH_BYTES = 8;

/** Measured: attract's only dispatch in 6000 frames. The budget clears it by under a hundred. */
const FIRST_DISPATCH_FRAME = 5313;
const BUDGET = 5400;

const skip = romsPresent() ? false : "ROM images are absent from this checkout";
const oracle = oracleAt(TARGET);

// ── the one expensive run ───────────────────────────────────────────────────────────────

let captured = null;

function session() {
  if (captured !== null) return captured;
  let dispatches = 0;
  let firstFrame = null;
  let entry = null;
  let droppedAtEntry = null;
  const host = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      if (entry === null) {
        entry = mm.clone();
        firstFrame = mm.frames.length;
        droppedAtEntry = mm.mem8[PLAY_ACTIVE] === 0;
      }
      return oracle(mm);
    }]]),
    { tape: [] },
  );
  const frames = host.runFrames(BUDGET);
  assert.equal(host.stoppedBy, null, `capture run stopped early: ${host.stoppedBy}`);
  assert.equal(frames.length, BUDGET, "capture run ran short");
  captured = { dispatches, firstFrame, entry, droppedAtEntry };
  return captured;
}

function entryState() {
  const e = session().entry;
  assert.notEqual(e, null, "vacuous: the attract tape never reached the routine");
  return e;
}

/** Both arms from the real entry, with the permission cell and the queue length forced. */
function craftedDiff(candidate, play, length) {
  const entry = entryState();
  const a = entry.clone();
  const b = entry.clone();
  for (const s of [a, b]) {
    s.mem8[PLAY_ACTIVE] = play;
    s.mem8[QUEUE_LENGTH] = length;
  }
  oracle(a);
  candidate(b);
  return realDiff(a, b, entry.regs.sp, SCRATCH_BYTES);
}

const PLAY_VALUES = [0x00, 0x01, 0x80, 0xff];

function playSweepCaught(candidate) {
  let caught = 0;
  for (const play of PLAY_VALUES) if (craftedDiff(candidate, play, 2)) caught++;
  return caught;
}

/** What the oracle appends, from a state where both requests are admitted. */
function appendedByOracle() {
  const s = entryState().clone();
  s.mem8[PLAY_ACTIVE] = 0xff;
  s.mem8[QUEUE_LENGTH] = 2;
  oracle(s);
  return { length: s.mem8[QUEUE_LENGTH], codes: [s.mem8[QUEUE_LENGTH + 3], s.mem8[QUEUE_LENGTH + 4]] };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: requestTwoSoundsWhilePlaying == oracle outside the scratch window", { skip }, () => {
  const s = session();
  assert.equal(s.dispatches, 1, "the attract dispatch count moved");
  assert.equal(s.firstFrame, FIRST_DISPATCH_FRAME, "the first dispatch moved; re-derive the budget");

  const entry = entryState();
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  requestTwoSoundsWhilePlaying(b);
  const d = realDiff(a, b, entry.regs.sp, SCRATCH_BYTES);
  assert.equal(d, null, `RAM diverged — ${show(d)}`);
  assert.ok(allDiffs(a, b).length > 0, "no divergence at all — the scratch pushes vanished");
  console.log(
    `  EQUAL: frame ${s.firstFrame}, sp=${hex4(entry.regs.sp)} play=${entry.mem8[PLAY_ACTIVE]} ` +
      `length=${entry.mem8[QUEUE_LENGTH]}; identical outside [SP-${SCRATCH_BYTES}, SP)`,
  );
});

test("THE ONE REAL DISPATCH IS REFUSED AND WRITES NOTHING", { skip }, () => {
  assert.equal(session().droppedAtEntry, true, "the real dispatch is no longer on the refusing path");
  const entry = entryState();
  const before = entry.clone();
  const after = entry.clone();
  oracle(after);
  const moved = allDiffs(before, after).filter((d) => d.addr >= entry.regs.sp);
  assert.deepEqual(
    moved,
    [],
    "the refused dispatch now moves a cell outside dead stack, so it is not a pure refusal",
  );
  assert.equal(
    after.mem8[QUEUE_LENGTH],
    before.mem8[QUEUE_LENGTH],
    "the refused dispatch appended to the queue",
  );
  console.log(
    "  REFUSED: the only real dispatch has the permission cell clear, so both requests are " +
      "dropped and no live cell moves — the crafted arms carry the admitting branch",
  );
});

test("THE TWO CODES IT ASKS FOR, and their order", { skip }, () => {
  const r = appendedByOracle();
  assert.equal(r.length, 4, "two entries must be appended, so the length must advance by two");
  assert.deepEqual(r.codes, [FIRST_CODE, SECOND_CODE], "the requested pair or its order moved");
  assert.notEqual(FIRST_CODE, SECOND_CODE, "the two codes must differ or the order arm is vacuous");
  const d = craftedDiff(requestTwoSoundsWhilePlaying, 0xff, 2);
  assert.equal(d, null, `the rewrite diverged on the admitting path — ${show(d)}`);
  console.log(`  CODES: the oracle appends ${r.codes.join(" then ")}, and the rewrite matches`);
});

test("IT READS THE IMAGE: the first code follows a poked source byte", { skip }, () => {
  const entry = entryState();
  assert.notEqual(POKED_CODE, FIRST_CODE, "the poke must actually change the byte");
  withPokedImage(entry, FIRST_CODE_CELL, POKED_CODE, () => {
    assert.deepEqual(
      appendedByOracle().codes,
      [POKED_CODE, SECOND_CODE],
      "the oracle ignored the poked source byte",
    );
    assert.equal(craftedDiff(requestTwoSoundsWhilePlaying, 0xff, 2), null, "the rewrite diverged under the poke");
    assert.notEqual(
      craftedDiff(brokenBakedFirstCode, 0xff, 2),
      null,
      "the baked-constant twin survived the poke, so this arm proves nothing",
    );
  });
  assert.deepEqual(appendedByOracle().codes, [FIRST_CODE, SECOND_CODE], "the poke leaked out");
  assert.equal(
    craftedDiff(brokenBakedFirstCode, 0xff, 2),
    null,
    "the baked-constant twin is caught WITHOUT the poke, so its blindness is not what is recorded",
  );
  console.log("  READS THE IMAGE: the first code tracks the source byte; the poke is undone");
});

test("THE PERMISSION CELL: swept, including the admitting branch", { skip }, () => {
  for (const play of PLAY_VALUES) {
    const d = craftedDiff(requestTwoSoundsWhilePlaying, play, 2);
    assert.equal(d, null, `play=${play}: ${show(d)}`);
  }
  console.log(`  PERMISSION: ${PLAY_VALUES.length} values identical, refusing and admitting alike`);
});

test("EXHAUSTIVE over the queue length: all 256, where its byte wrap lives", { skip }, () => {
  for (let length = 0; length < 256; length++) {
    const d = craftedDiff(requestTwoSoundsWhilePlaying, 0xff, length);
    assert.equal(d, null, `length=${length}: ${show(d)}`);
  }
  // AT THE WRAP THE FIRST REQUEST LANDS ON THE LENGTH CELL ITSELF. 255 steps to 0, and the entry
  // that offset selects IS the length, so the first code overwrites it and the second request then
  // reads that code back as the length. Measured, and asserted so the wrap cannot quietly change.
  const wrapped = entryState().clone();
  wrapped.mem8[PLAY_ACTIVE] = 0xff;
  wrapped.mem8[QUEUE_LENGTH] = 255;
  requestTwoSoundsWhilePlaying(wrapped);
  assert.equal(wrapped.mem8[QUEUE_LENGTH], FIRST_CODE + 1, "the wrap no longer folds onto itself");
  assert.equal(wrapped.mem8[QUEUE_LENGTH + FIRST_CODE + 1], SECOND_CODE, "the second entry moved");
  console.log(
    `  EXHAUSTIVE: 256 queue lengths identical; at 255 the first code lands ON the length cell ` +
      `and the length ends at ${wrapped.mem8[QUEUE_LENGTH]}`,
  );
});

test("EXCLUDED, deliberately: registers, pc and the scratch window and nothing else", { skip }, () => {
  const entry = entryState();
  const a = entry.clone();
  const b = entry.clone();
  a.mem8[PLAY_ACTIVE] = 0xff;
  b.mem8[PLAY_ACTIVE] = 0xff;
  oracle(a);
  requestTwoSoundsWhilePlaying(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.ok(
    moved.every((k) => ["a", "f", "sp"].includes(k)),
    `only the accumulator, the flag byte and the stack pointer may differ — saw ${moved.join(", ")}`,
  );
  assert.ok(moved.includes("sp"), "the oracle's return must move the stack pointer");
  assert.equal(a.regs.sp - b.regs.sp, 2, "the oracle pops its return address; the rewrite does not");
  assert.equal(a.regs.a, SECOND_CODE, "the oracle leaves the second code in the accumulator");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: registers ${moved.join(", ")}, pc, and the scratch window only`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: carries the first code as an immediate instead of reading the image for it. */
function brokenBakedFirstCode(m) {
  loc_560c(m, FIRST_CODE);
  loc_560c(m, m.mem8[SECOND_CODE_CELL]);
}

/** BUG: asks for the first sound only, so the second never reaches the queue. */
function brokenFirstOnly(m) {
  loc_560c(m, m.mem8[FIRST_CODE_CELL]);
}

/** BUG: asks for the second sound only. */
function brokenSecondOnly(m) {
  loc_560c(m, m.mem8[SECOND_CODE_CELL]);
}

/** BUG: the two requests go in the other way round. */
function brokenSwapsOrder(m) {
  loc_560c(m, m.mem8[SECOND_CODE_CELL]);
  loc_560c(m, m.mem8[FIRST_CODE_CELL]);
}

/** BUG: skips the permission test, so the pair is queued even when a game is not being played. */
function brokenUngated(m) {
  loc_562a(m, m.mem8[FIRST_CODE_CELL]);
  loc_562a(m, m.mem8[SECOND_CODE_CELL]);
}

/**
 * Per twin: how many of the four permission values catch it. One of the four REFUSES and three
 * ADMIT, so a twin that gets the queued pair wrong is caught on three and `ungated`, which queues
 * where the oracle refuses, on one. `baked-first-code` is invisible on a genuine image at every
 * one of them; the poked arm above is the only thing that sees it, and its zero is asserted here
 * so that blindness can never be mistaken for coverage.
 */
const TWINS = [
  ["no-op", brokenNoOp, 3],
  ["baked-first-code", brokenBakedFirstCode, 0],
  ["first-only", brokenFirstOnly, 3],
  ["second-only", brokenSecondOnly, 3],
  ["swaps-order", brokenSwapsOrder, 3],
  ["ungated", brokenUngated, 1],
];

for (const [label, twin, caught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of permission values`, { skip }, () => {
    assert.equal(playSweepCaught(twin), caught, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${PLAY_VALUES.length} permission values`);
  });
}

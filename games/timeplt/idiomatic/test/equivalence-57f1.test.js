// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_57f1 — memory-equivalent to the frozen oracle at ROM 0x57F1.
 *
 * WHAT IT IS. Two instructions: load one byte of the program image into A, then transfer to the
 * shared request body at ROM 0x5628, WHICH IS ALREADY DECOMPILED — so the rewrite calls it
 * directly with the byte as an argument, and dissolving that transfer belongs to this caller's
 * unit. The whole content of the entry is therefore WHICH sound code it asks for and WHICH
 * permission it asks under, and this gate is built to see both: the permission is nothing at all — it is the unconditional entry,
 * and the code is fetched at run time rather than carried as an immediate.
 *
 * ★ THE TWIN THAT A GENUINE IMAGE CANNOT DISCRIMINATE. A rewrite that hard-codes the sound code
 *   instead of reading it is byte-for-byte identical to the real one on an unmodified image —
 *   the check that would "prove" the read is live cannot fail. So one arm POKES the source byte
 *   and re-runs both sides: the routine must follow the poke and the baked-constant twin must
 *   not. That twin is asserted to be INVISIBLE without the poke and caught with it, so its
 *   agreement on a genuine image is never read as reassurance.
 *
 * GATE: strict unit-capture, plus exhaustive crafted sweeps. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — every byte of the state dump agrees except inside
 *      the scratch window named in 2.
 *   2. THE DEAD SCRATCH IS THE ONE EXCLUSION, PINNED to [SP-6, SP): the body's two pushed pairs
 *      and the return address it pushes for its restart. An upper bound and not a prediction.
 *   3. REGISTERS AND PC ARE EXCLUDED, DELIBERATELY, and pinned to a fixed shape.
 *   4. THE CODE IT REQUESTS, read back from the oracle rather than asserted about the source.
 *   5. IT READS THE IMAGE — the poked arm described above.
 *   6. GATE CROSS — both permission cells swept against each other, which is the only coverage
 *      of the drop branch; no tape state reaches it.
 *   7. EXHAUSTIVE over the queue length, 0..255.
 *   8. TEETH — four twins, with the baked-constant one's blindness pinned.
 *
 * HOLE: WHAT the sound is. Nothing on this CPU can say; the code is a byte handed to a second
 * processor. This gate fixes which byte and under what permission, and claims nothing more.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-57f1.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent } from "./_harness.js";
import {
  DEMO_SOUNDS,
  QUEUE_LENGTH,
  allDiffs,
  captureEntry,
  hex4,
  oracleAt,
  realDiff,
  show,
  withPokedImage,
} from "./_soundQueue.js";
import { loc_57f1 } from "../loc_57f1.js";
import { loc_5628 } from "../loc_5628.js";
import { loc_562a } from "../loc_562a.js";
import { PLAY_ACTIVE } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x57f1;
const SOUND_CODE_CELL = 0x322e;
const EXPECTED_CODE = 0x01;
const WRONG_SOURCE = SOUND_CODE_CELL + 1;
const POKED_CODE = 0x5b;
const SCRATCH_BYTES = 6;

const skip = romsPresent() ? false : "ROM images are absent from this checkout";
const oracle = oracleAt(TARGET);

function entryState() {
  const e = captureEntry(TARGET);
  assert.notEqual(e, null, "vacuous: the tape reached neither the entry nor its tail");
  return e;
}

/** Both arms from the base entry, with the permission cells and the queue length forced. */
function craftedDiff(cand, play, demo, length) {
  const entry = entryState();
  const arms = [entry.clone(), entry.clone()];
  for (const s of arms) {
    s.mem8[PLAY_ACTIVE] = play;
    s.mem8[DEMO_SOUNDS] = demo;
    s.mem8[QUEUE_LENGTH] = length;
  }
  oracle(arms[0]);
  cand(arms[1]);
  return realDiff(arms[0], arms[1], entry.regs.sp, SCRATCH_BYTES);
}

const PLAY_VALUES = [0x00, 0x01, 0xff];
const DEMO_VALUES = [0x00, 0x01];
const CROSS_SIZE = PLAY_VALUES.length * DEMO_VALUES.length;

function crossCaught(cand) {
  let caught = 0;
  for (const play of PLAY_VALUES) {
    for (const demo of DEMO_VALUES) if (craftedDiff(cand, play, demo, 3)) caught++;
  }
  return caught;
}

/** The code the oracle actually appended, from a state where the request is admitted. */
function codeAppendedByOracle() {
  const s = entryState().clone();
  s.mem8[PLAY_ACTIVE] = 0xff;
  s.mem8[DEMO_SOUNDS] = 0x01;
  s.mem8[QUEUE_LENGTH] = 2;
  oracle(s);
  assert.equal(s.mem8[QUEUE_LENGTH], 3, "the admitted request did not append at all");
  return s.mem8[QUEUE_LENGTH + 3];
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: loc_57f1 == oracle on RAM", { skip }, () => {
  const entry = entryState();
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  loc_57f1(b);
  const d = realDiff(a, b, entry.regs.sp, SCRATCH_BYTES);
  assert.equal(d, null, `RAM diverged — ${show(d)}`);
  assert.ok(allDiffs(a, b).length > 0, "no divergence at all — the scratch push vanished");
  console.log(
    `  EQUAL: entry sp=${hex4(entry.regs.sp)} play=${entry.mem8[PLAY_ACTIVE]} ` +
      `length=${entry.mem8[QUEUE_LENGTH]}; RAM identical outside [SP-${SCRATCH_BYTES}, SP)`,
  );
});

test("EXCLUDED, deliberately: registers, pc and the scratch window and nothing else", { skip }, () => {
  const entry = entryState();
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  loc_57f1(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.ok(moved.includes("sp"), "the oracle's return must move the stack pointer");
  assert.ok(
    moved.every((k) => ["a", "f", "sp"].includes(k)),
    `only the accumulator, the flag byte and the stack pointer may differ — saw ${moved.join(", ")}`,
  );
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.equal(a.regs.sp - b.regs.sp, 2, "the oracle pops its return address; the rewrite does not");
  const outside = allDiffs(a, b).filter(
    (d) => d.addr < entry.regs.sp - SCRATCH_BYTES || d.addr >= entry.regs.sp,
  );
  assert.deepEqual(outside, [], "a divergence escaped the scratch window");
  console.log(`  EXCLUDED: registers ${moved.join(", ")}, pc, and the scratch window only`);
});

test("THE CODE IT REQUESTS: the byte the oracle appends", { skip }, () => {
  assert.equal(codeAppendedByOracle(), EXPECTED_CODE, "the requested sound code moved");
  console.log(`  CODE: the oracle appends ${hex4(EXPECTED_CODE)} & 0xff`);
});

test("IT READS THE IMAGE: the requested code follows a poked source byte", { skip }, () => {
  const entry = entryState();
  assert.notEqual(POKED_CODE, EXPECTED_CODE, "the poke must actually change the byte");
  withPokedImage(entry, SOUND_CODE_CELL, POKED_CODE, () => {
    assert.equal(codeAppendedByOracle(), POKED_CODE, "the oracle ignored the poked source byte");
    const d = craftedDiff(loc_57f1, 0xff, 0x01, 3);
    assert.equal(d, null, `the rewrite diverged under the poke — ${show(d)}`);
  });
  assert.equal(codeAppendedByOracle(), EXPECTED_CODE, "the poke leaked past its own scope");
  console.log("  READS THE IMAGE: the appended code tracks the source byte, and the poke is undone");
});

test("GATE CROSS: both permission cells swept, including the drop branch", { skip }, () => {
  for (const play of PLAY_VALUES) {
    for (const demo of DEMO_VALUES) {
      const d = craftedDiff(loc_57f1, play, demo, 3);
      assert.equal(d, null, `play=${play} demo=${demo}: ${show(d)}`);
    }
  }
  console.log(`  GATE CROSS: ${CROSS_SIZE} permission combinations identical`);
});

test("EXHAUSTIVE over the queue length", { skip }, () => {
  for (let length = 0; length < 256; length++) {
    const d = craftedDiff(loc_57f1, 0xff, 0x01, length);
    assert.equal(d, null, `length=${length}: ${show(d)}`);
  }
  console.log("  EXHAUSTIVE: 256 queue lengths identical");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: carries the sound code as an immediate instead of reading the image for it. */
function brokenBakedConstant(m) {
  loc_5628(m, EXPECTED_CODE);
}

/** BUG: reads a neighbouring byte of the image, so it asks for a different sound. */
function brokenWrongSource(m) {
  loc_5628(m, m.mem8[WRONG_SOURCE]);
}

/** BUG: asks under the wrong permission — the behaviour of a different shared body. */
function brokenMisgated(m) {
  if (m.mem8[PLAY_ACTIVE] === 0) return;
  loc_562a(m, m.mem8[SOUND_CODE_CELL]);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["wrong-source", brokenWrongSource],
  ["misgated-gates-on-play", brokenMisgated],
];

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT in the crafted cross`, { skip }, () => {
    const caught = crossCaught(twin);
    assert.ok(caught > 0, `the cross PASSED the ${label} twin — it has no teeth`);
    const first = PLAY_VALUES.flatMap((p) => DEMO_VALUES.map((dm) => craftedDiff(twin, p, dm, 3))).find(
      Boolean,
    );
    console.log(`  TEETH/${label}: caught on ${caught}/${CROSS_SIZE} — first ${show(first)}`);
  });
}

test("TEETH: the baked-constant twin is INVISIBLE on a genuine image and caught under the poke", { skip }, () => {
  assert.equal(
    crossCaught(brokenBakedConstant),
    0,
    "a genuine image was expected to be blind to it; if it is not, this arm proves nothing",
  );
  const entry = entryState();
  const caught = withPokedImage(entry, SOUND_CODE_CELL, POKED_CODE, () =>
    crossCaught(brokenBakedConstant),
  );
  assert.ok(caught > 0, "the poked cross ALSO passed it — nothing here tests that the read is live");
  console.log(`  TEETH/baked-constant: blind on a genuine image, caught on ${caught}/${CROSS_SIZE} poked`);
});

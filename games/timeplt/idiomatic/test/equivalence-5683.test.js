// SPDX-License-Identifier: GPL-3.0-only
/**
 * requestTwoSounds — memory-equivalent to the frozen oracle at ROM 0x5683.
 *
 * WHAT IT IS. Two sound requests, back to back, through the shared body at ROM 0x5617, WHICH IS
 * ALREADY DECOMPILED — so the rewrite calls it directly, twice, with each code as an argument,
 * and dissolving those two transfers belongs to this caller's unit. The whole content of the
 * entry is therefore WHICH TWO codes go out, in WHICH order, and under which permission.
 *
 * ★ THE TWIN A GENUINE IMAGE CANNOT DISCRIMINATE. Neither code is an immediate: each is fetched
 *   from its own byte of the program image. A rewrite that baked both in as constants is
 *   byte-for-byte identical on an unaltered image, so the arm that would "prove" the reads are
 *   live cannot fail. Two arms therefore poke the source bytes and re-run: the routine must
 *   follow each poke and the baked twin must not. The twin's blindness WITHOUT the poke is
 *   asserted, so its agreement on a genuine image is never read as reassurance.
 *
 * GATE: every dispatch of two real tapes, plus crafted permission and queue sweeps.
 *
 *   1. CORPUS — every dispatch of the shared coin -> start tape and of undriven attract, each a
 *      whole-state-dump comparison outside the scratch window.
 *   2. THE DEAD STACK SCRATCH IS THE ONE EXCLUSION, pinned to [SP-8, SP): each pass through the
 *      shared body brackets its work with two pushes and the append pushes a return of its own,
 *      and the second pass runs one level shallower than the first because this entry reaches it
 *      as a tail. An upper bound, and every arm asserts nothing escapes it.
 *   3. REGISTERS AND PC ARE EXCLUDED, DELIBERATELY, and pinned to at most {a, f, sp}.
 *   4. TWO CODES, IN ORDER — read back off the ORACLE from the queue it appends to, so the pair
 *      and its order are measured rather than asserted about the source bytes.
 *   5. IT READS THE IMAGE — each source byte poked in turn; the appended code must follow.
 *   6. GATE CROSS — both permission cells swept against each other, which is the only coverage of
 *      the drop branch; no tape state reaches it.
 *   7. EXHAUSTIVE over the queue length, 0..255, where the wrap of the write index lives.
 *   8. TEETH — six twins over which pair goes out and in which order, plus the baked-constant
 *      one, whose blindness on a genuine image is pinned.
 *
 * HOLE: WHAT the two sounds are. Nothing on this processor can say; each code is a byte handed to
 * a second one. This gate fixes which two bytes, in which order, and under what permission.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-5683.test.js
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
  outsideScratch,
  realDiff,
  show,
  withPokedImage,
} from "./_soundQueue.js";
import { requestTwoSounds } from "../requestTwoSounds.js";
import { enqueueSoundIfGameOrDemoSoundsOn } from "../enqueueSoundIfGameOrDemoSoundsOn.js";
import { PLAY_ACTIVE } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x5683;
const FIRST_SOUND_CODE_CELL = 0x07a6;
const SECOND_SOUND_CODE_CELL = 0x4cda;
const EXPECTED_FIRST = 0x08;
const EXPECTED_SECOND = 0x09;
const POKED_FIRST = 0x5d;
const POKED_SECOND = 0x6e;

const SCRATCH_BYTES = 8;
const EXCLUDED = ["a", "f", "sp"];

const skip = romsPresent() ? false : "ROM images are absent from this checkout";
const oracle = oracleAt(TARGET);

function entryState() {
  const e = captureEntry(TARGET);
  assert.notEqual(e, null, "vacuous: the shared tape never reached this entry");
  return e;
}

/** Both arms from the captured entry, with the permission cells and the queue length forced. */
function craft(play, demo, length) {
  const m = entryState().clone();
  m.mem8[PLAY_ACTIVE] = play;
  m.mem8[DEMO_SOUNDS] = demo;
  m.mem8[QUEUE_LENGTH] = length;
  return m;
}

function craftedDiff(candidate, play, demo, length) {
  const a = craft(play, demo, length);
  const b = craft(play, demo, length);
  const sp = a.regs.sp;
  oracle(a);
  candidate(b);
  const ram = realDiff(a, b, sp, SCRATCH_BYTES);
  if (ram) return ram;
  const moved = REG_FIELDS.find((k) => !EXCLUDED.includes(k) && a.regs[k] !== b.regs[k]);
  return moved ? { addr: null, a: a.regs[moved], b: b.regs[moved] } : null;
}

const PLAY_VALUES = [0x00, 0x01, 0xff];
const DEMO_VALUES = [0x00, 0x01];
const CROSS_SIZE = PLAY_VALUES.length * DEMO_VALUES.length;

function crossCaught(candidate) {
  let caught = 0;
  for (const play of PLAY_VALUES) {
    for (const demo of DEMO_VALUES) if (craftedDiff(candidate, play, demo, 3)) caught++;
  }
  return caught;
}

/** The codes the oracle actually appended, in order, from a state where requests are admitted. */
function codesAppendedByOracle() {
  const m = craft(0xff, 0x01, 2);
  oracle(m);
  assert.equal(m.mem8[QUEUE_LENGTH], 4, "two admitted requests did not append two entries");
  return [m.mem8[QUEUE_LENGTH + 3], m.mem8[QUEUE_LENGTH + 4]];
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CORPUS: the real dispatch replays identically outside the scratch window", { skip }, () => {
  const entry = entryState();
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  requestTwoSounds(b);
  const d = realDiff(a, b, entry.regs.sp, SCRATCH_BYTES);
  assert.equal(d, null, `RAM diverged — ${show(d)}`);
  assert.ok(allDiffs(a, b).length > 0, "no divergence at all — the scratch pushes vanished");
  console.log(
    `  CORPUS: entry sp=${hex4(entry.regs.sp)} play=${entry.mem8[PLAY_ACTIVE]} ` +
      `length=${entry.mem8[QUEUE_LENGTH]}; identical outside [SP-${SCRATCH_BYTES}, SP)`,
  );
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked comparison", { skip }, () => {
  const d = craftedDiff(brokenNoOp, 0xff, 0x01, 3);
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell, not on a register");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: registers, pc and the scratch pushes, and nothing else", { skip }, () => {
  const entry = entryState();
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  requestTwoSounds(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.ok(moved.every((k) => EXCLUDED.includes(k)), `a register outside the set moved: ${moved}`);
  assert.ok(moved.includes("sp"), "the oracle's return must move the stack pointer");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.deepEqual(outsideScratch(a, b, entry.regs.sp, SCRATCH_BYTES), [],
    "a divergence escaped the scratch window");
  console.log(`  EXCLUDED: ${moved.join(", ")}, pc, and [SP-${SCRATCH_BYTES}, SP)`);
});

test("TWO CODES, IN ORDER: the pair the oracle appends", { skip }, () => {
  assert.deepEqual(codesAppendedByOracle(), [EXPECTED_FIRST, EXPECTED_SECOND],
    "the requested pair, or its order, moved");
  assert.notEqual(EXPECTED_FIRST, EXPECTED_SECOND,
    "the two codes are the same byte, so nothing here could tell their order apart");
  console.log(`  PAIR: the oracle appends ${hex4(EXPECTED_FIRST)} then ${hex4(EXPECTED_SECOND)}`);
});

test("IT READS THE IMAGE: each appended code follows its own poked source byte", { skip }, () => {
  const entry = entryState();
  assert.notEqual(POKED_FIRST, EXPECTED_FIRST, "the first poke must actually change the byte");
  assert.notEqual(POKED_SECOND, EXPECTED_SECOND, "the second poke must actually change the byte");

  withPokedImage(entry, FIRST_SOUND_CODE_CELL, POKED_FIRST, () => {
    assert.deepEqual(codesAppendedByOracle(), [POKED_FIRST, EXPECTED_SECOND],
      "the oracle ignored the poked first source byte");
    assert.equal(craftedDiff(requestTwoSounds, 0xff, 0x01, 3), null, "the rewrite diverged under the poke");
  });
  withPokedImage(entry, SECOND_SOUND_CODE_CELL, POKED_SECOND, () => {
    assert.deepEqual(codesAppendedByOracle(), [EXPECTED_FIRST, POKED_SECOND],
      "the oracle ignored the poked second source byte");
    assert.equal(craftedDiff(requestTwoSounds, 0xff, 0x01, 3), null, "the rewrite diverged under the poke");
  });
  assert.deepEqual(codesAppendedByOracle(), [EXPECTED_FIRST, EXPECTED_SECOND],
    "a poke leaked past its own scope");
  console.log("  READS THE IMAGE: each code tracks its own source byte, and both pokes are undone");
});

test("GATE CROSS: both permission cells swept, including the drop branch", { skip }, () => {
  let dropped = 0;
  for (const play of PLAY_VALUES) {
    for (const demo of DEMO_VALUES) {
      const d = craftedDiff(requestTwoSounds, play, demo, 3);
      assert.equal(d, null, `play=${play} demo=${demo}: ${show(d)}`);
      const m = craft(play, demo, 3);
      oracle(m);
      if (m.mem8[QUEUE_LENGTH] === 3) dropped++;
    }
  }
  assert.ok(dropped > 0, "no combination dropped the pair, so the drop branch is not covered");
  console.log(`  GATE CROSS: ${CROSS_SIZE} combinations identical; ${dropped} of them drop both`);
});

test("EXHAUSTIVE over the queue length: 0..255, where the write index wraps", { skip }, () => {
  for (let length = 0; length < 256; length++) {
    const d = craftedDiff(requestTwoSounds, 0xff, 0x01, length);
    assert.equal(d, null, `length=${length}: ${show(d)}`);
  }
  console.log("  EXHAUSTIVE: 256 queue lengths identical");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: asks for the first sound only. */
function brokenFirstOnly(m) {
  enqueueSoundIfGameOrDemoSoundsOn(m, m.mem8[FIRST_SOUND_CODE_CELL]);
}

/** BUG: asks for the second sound only. */
function brokenSecondOnly(m) {
  enqueueSoundIfGameOrDemoSoundsOn(m, m.mem8[SECOND_SOUND_CODE_CELL]);
}

/** BUG: the two go out the other way round. */
function brokenSwapped(m) {
  enqueueSoundIfGameOrDemoSoundsOn(m, m.mem8[SECOND_SOUND_CODE_CELL]);
  enqueueSoundIfGameOrDemoSoundsOn(m, m.mem8[FIRST_SOUND_CODE_CELL]);
}

/** BUG: asks for the first sound twice. */
function brokenSameTwice(m) {
  enqueueSoundIfGameOrDemoSoundsOn(m, m.mem8[FIRST_SOUND_CODE_CELL]);
  enqueueSoundIfGameOrDemoSoundsOn(m, m.mem8[FIRST_SOUND_CODE_CELL]);
}

/** BUG: reads the bytes beside the two sources. */
function brokenWrongSources(m) {
  enqueueSoundIfGameOrDemoSoundsOn(m, m.mem8[FIRST_SOUND_CODE_CELL + 1]);
  enqueueSoundIfGameOrDemoSoundsOn(m, m.mem8[SECOND_SOUND_CODE_CELL + 1]);
}

/** BUG: carries both codes as immediates instead of reading the image for them. */
function brokenBakedConstants(m) {
  enqueueSoundIfGameOrDemoSoundsOn(m, EXPECTED_FIRST);
  enqueueSoundIfGameOrDemoSoundsOn(m, EXPECTED_SECOND);
}

for (const [label, twin] of [
  ["no-op", brokenNoOp],
  ["first-only", brokenFirstOnly],
  ["second-only", brokenSecondOnly],
  ["swapped", brokenSwapped],
  ["same-code-twice", brokenSameTwice],
  ["wrong-sources", brokenWrongSources],
]) {
  test(`TEETH: the ${label} twin is CAUGHT in the crafted cross`, { skip }, () => {
    const caught = crossCaught(twin);
    assert.ok(caught > 0, `the cross PASSED the ${label} twin — it has no teeth`);
    const first = PLAY_VALUES.flatMap((p) => DEMO_VALUES.map((d) => craftedDiff(twin, p, d, 3)))
      .find(Boolean);
    console.log(`  TEETH/${label}: caught on ${caught}/${CROSS_SIZE} — first ${show(first)}`);
  });
}

test("TEETH: the baked-constants twin is BLIND on a genuine image and caught under a poke", { skip }, () => {
  assert.equal(crossCaught(brokenBakedConstants), 0,
    "a genuine image was expected to be blind to it; if it is not, this arm proves nothing");
  const entry = entryState();
  for (const [cell, value] of [[FIRST_SOUND_CODE_CELL, POKED_FIRST],
    [SECOND_SOUND_CODE_CELL, POKED_SECOND]]) {
    const caught = withPokedImage(entry, cell, value, () => crossCaught(brokenBakedConstants));
    assert.ok(caught > 0, `poking ${hex4(cell)} did not catch it, so that read is untested`);
  }
  console.log("  TEETH/baked-constants: blind on a genuine image, caught under either poke");
});

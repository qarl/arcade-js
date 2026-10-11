// SPDX-License-Identifier: GPL-3.0-only
/**
 * enqueueSoundIfGameOrDemoSoundsOn — memory-equivalent to the frozen oracle at ROM 0x5617.
 * WHAT IT IS, AND WHAT SEPARATES IT FROM 0x560C. Same shape as its sibling — spill the command byte, test
 * permission, tail-jump into the enqueue body at 0x562A — but it tests TWO cells and either one on its own
 * admits the request. The first is the play-active flag its sibling uses. The second is 0xA9C6, and the two
 * entries are otherwise interchangeable, so what that cell IS is the whole of the difference between them:
 *   0xA9C6 is written exactly once in the image, by the boot-time switch unpack, and read exactly once, here.
 *   The unpack rotates the COMPLEMENT of the DSW1 byte and lands bit 7 in this cell. MAME's own port table
 *   for this driver gives DSW1 bit 7 as Demo Sounds, active low — and the same unpack's neighbouring fields
 *   corroborate that layout from the code side rather than by citation: bits 0-1 go through `and 3 / add 3 /
 *   cp 6 -> 255`, which is exactly the 3 / 4 / 5 / 255 lives ladder the same table lists. So the second gate
 *   is the demo-sound switch, and the routine reads: sound during a game, or in attract when the cabinet is
 *   set to make noise. That is a claim the gate can test as behaviour, and the cross below does.
 * ★ THE HOLE. Every dispatch the shared tape produces has the play flag SET and the demo switch
 *   ON, so neither the drop branch nor the second-cell-only branch ever executes on real data.
 *   With both cells admitting, every twin that differs only in WHICH cell it consults behaves
 *   exactly as the routine does: measured, FOUR of the five twins below are invisible at the real
 *   dispatch and only the do-nothing twin is caught there. An arm asserts that list rather than
 *   describing it. So the crafted cross is not a supplement here — it is the entire coverage of
 *   this gate, and the real dispatch's agreement is worth almost nothing on its own.
 *
 * GATE: strict unit-capture at the real dispatch, plus an exhaustive crafted cross. What it
 *   exercises, holes stated:
 *   1. EQUAL at the real dispatch — RAM identical outside the scratch window named in 2.
 *   2. THE DEAD SCRATCH IS THE ONE EXCLUSION, PINNED to [SP-6, SP), an upper bound: at the real
 *      entry only one byte inside it actually differs, because the pushed bytes happened to match
 *      what was already there. That is why the arm asserts CONTAINMENT and never equality.
 *   3. REGISTERS AND PC ARE EXCLUDED, DELIBERATELY, and pinned to a fixed shape.
 *   4. EXHAUSTIVE over the full cross of both cells — play 0..255 against both switch settings.
 *   5. THE TRUTH TABLE, read back from the oracle: it drops when and only when BOTH are clear.
 *      This is the arm that would have failed had the two cells been ANDed, or had the second
 *      been ignored, and it is what makes the sibling distinction a measurement.
 *   6. EXHAUSTIVE over the queue length, 0..255.
 *   7. TEETH — five twins, plus the pinned list of which the real dispatch cannot see.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-5617.test.js
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
} from "./_soundQueue.js";
import { enqueueSoundIfGameOrDemoSoundsOn } from "../enqueueSoundIfGameOrDemoSoundsOn.js";
import { appendSoundCommandToQueue } from "../appendSoundCommandToQueue.js";
import { PLAY_ACTIVE } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x5617;
const SCRATCH_BYTES = 6;

const skip = romsPresent() ? false : "ROM images are absent from this checkout";
const oracle = oracleAt(TARGET);

function entryState() {
  const e = captureEntry(TARGET);
  assert.notEqual(e, null, "vacuous: the tape never reached the routine");
  return e;
}

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

function realDispatchDiff(cand) {
  const entry = entryState();
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  cand(b);
  return realDiff(a, b, entry.regs.sp, SCRATCH_BYTES);
}

const DEMO_VALUES = [0x00, 0x01];
const CROSS_SIZE = 256 * DEMO_VALUES.length;

function crossCaught(cand) {
  let caught = 0;
  for (let play = 0; play < 256; play++) {
    for (const demo of DEMO_VALUES) if (craftedDiff(cand, play, demo, 3)) caught++;
  }
  return caught;
}

/** Did the oracle append, from this pair of permission values? */
function oraclePosts(play, demo) {
  const s = entryState().clone();
  s.mem8[PLAY_ACTIVE] = play;
  s.mem8[DEMO_SOUNDS] = demo;
  s.mem8[QUEUE_LENGTH] = 2;
  oracle(s);
  return s.mem8[QUEUE_LENGTH] === 3;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: enqueueSoundIfGameOrDemoSoundsOn == oracle on RAM", { skip }, () => {
  const entry = entryState();
  assert.equal(realDispatchDiff(enqueueSoundIfGameOrDemoSoundsOn), null, "RAM diverged at the real dispatch");
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  enqueueSoundIfGameOrDemoSoundsOn(b);
  assert.ok(allDiffs(a, b).length > 0, "no divergence at all — the scratch push vanished");
  console.log(
    `  EQUAL: entry sp=${hex4(entry.regs.sp)} play=${entry.mem8[PLAY_ACTIVE]} ` +
      `demo=${entry.mem8[DEMO_SOUNDS]} command=${hex4(entry.regs.a)}; ` +
      `${allDiffs(a, b).length} byte(s) differ, all inside [SP-${SCRATCH_BYTES}, SP)`,
  );
});

test("EXCLUDED, deliberately: registers, pc and the scratch window and nothing else", { skip }, () => {
  const entry = entryState();
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  enqueueSoundIfGameOrDemoSoundsOn(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.deepEqual(moved, ["sp"], "the excluded set changed shape: only the stack pointer may move");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.equal(a.regs.sp - b.regs.sp, 2, "the oracle pops its return address; the rewrite does not");
  const outside = allDiffs(a, b).filter(
    (d) => d.addr < entry.regs.sp - SCRATCH_BYTES || d.addr >= entry.regs.sp,
  );
  assert.deepEqual(outside, [], "a divergence escaped the scratch window");
  console.log(`  EXCLUDED: registers ${moved.join(", ")}, pc, and the scratch window only`);
});

test("EXHAUSTIVE over both permission cells: the full cross is identical", { skip }, () => {
  for (let play = 0; play < 256; play++) {
    for (const demo of DEMO_VALUES) {
      const d = craftedDiff(enqueueSoundIfGameOrDemoSoundsOn, play, demo, 3);
      assert.equal(d, null, `play=${play} demo=${demo}: ${show(d)}`);
    }
  }
  console.log(`  EXHAUSTIVE: ${CROSS_SIZE} gate combinations identical`);
});

test("THE TRUTH TABLE: either cell admits the request; only both clear drops it", { skip }, () => {
  assert.equal(oraclePosts(0x00, 0x00), false, "both clear must DROP");
  assert.equal(oraclePosts(0xff, 0x00), true, "the play flag alone must admit");
  assert.equal(oraclePosts(0x00, 0x01), true, "the demo-sound switch alone must admit");
  assert.equal(oraclePosts(0xff, 0x01), true, "both set must admit");
  console.log("  TRUTH TABLE: drop only with both clear — the second cell genuinely admits alone");
});

test("EXHAUSTIVE over the queue length", { skip }, () => {
  for (let length = 0; length < 256; length++) {
    const d = craftedDiff(enqueueSoundIfGameOrDemoSoundsOn, 0x00, 0x01, length);
    assert.equal(d, null, `length=${length}: ${show(d)}`);
  }
  console.log("  EXHAUSTIVE: 256 queue lengths identical on the second cell's branch alone");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: consults only the play flag, which is the sibling entry's behaviour, not this one's. */
function brokenIgnoresDemo(m) {
  if (m.mem8[PLAY_ACTIVE] === 0) return;
  appendSoundCommandToQueue(m, m.regs.a);
}

/** BUG: consults only the switch, so an in-game sound is lost when demo sound is off. */
function brokenIgnoresPlay(m) {
  if (m.mem8[DEMO_SOUNDS] === 0) return;
  appendSoundCommandToQueue(m, m.regs.a);
}

/** BUG: requires BOTH, turning an either-way permission into a conjunction. */
function brokenRequiresBoth(m) {
  if (m.mem8[PLAY_ACTIVE] === 0 || m.mem8[DEMO_SOUNDS] === 0) return;
  appendSoundCommandToQueue(m, m.regs.a);
}

/** BUG: posts unconditionally, so attract sounds with the switch off. */
function brokenUngated(m) {
  appendSoundCommandToQueue(m, m.regs.a);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["ignores-demo", brokenIgnoresDemo],
  ["ignores-play", brokenIgnoresPlay],
  ["requires-both", brokenRequiresBoth],
  ["ungated", brokenUngated],
];

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT in the crafted cross`, { skip }, () => {
    const caught = crossCaught(twin);
    assert.ok(caught > 0, `the cross PASSED the ${label} twin — it has no teeth`);
    const first = [...Array(256).keys()]
      .flatMap((p) => DEMO_VALUES.map((dm) => craftedDiff(twin, p, dm, 3)))
      .find(Boolean);
    console.log(`  TEETH/${label}: caught on ${caught}/${CROSS_SIZE} — first ${show(first)}`);
  });
}

test("TEETH: the real dispatch alone is BLIND to some of them, and the cross is not", { skip }, () => {
  const blind = TWINS.filter(([, twin]) => realDispatchDiff(twin) === null).map(([l]) => l);
  assert.deepEqual(
    blind,
    ["ignores-demo", "ignores-play", "requires-both", "ungated"],
    "the set of behaviours the real dispatch cannot discriminate moved — re-derive the cross",
  );
  for (const label of blind) {
    assert.ok(crossCaught(TWINS.find(([l]) => l === label)[1]) > 0, `${label} escapes both`);
  }
  console.log(`  TEETH: real-dispatch-blind but cross-caught — ${blind.join(", ")}`);
});

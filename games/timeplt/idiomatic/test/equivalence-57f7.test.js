// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_57f7 — memory-equivalent to the frozen oracle at ROM 0x57F7.
 *
 * WHAT IT IS, AND WHY IT GETS ITS OWN GATE RATHER THAN THE FAMILY'S. Every other entry in this
 * family loads a FIXED byte of the program image and hands it to a shared request body. This one
 * loads the era index out of work RAM and ADDS a constant to it, so the sound it asks for is
 * chosen by how far into the game the player has got. That makes its input space a live RAM cell
 * rather than an immutable byte, which is a far better thing to gate: the sweep below drives the
 * cell through all 256 values and checks the requested code against every one of them, so a
 * rewrite that hard-coded any single code — or dropped the addition, or applied it to the wrong
 * cell — dies immediately. No image poke is needed to make the read live.
 *
 * ★ NOT REACHED BY THE SHARED TAPE. It is dispatched through a path the coin -> start tape does
 *   not drive, so the arms run from a real machine state captured at its tail at ROM 0x560C — a
 *   genuine in-play state with a surgical entry, not a fabrication.
 *
 * ★ THE BYTE WRAP IS NOT THIS ROUTINE'S TO GET WRONG, and an arm below establishes that rather
 *   than assuming it. The addition is an eight-bit add, so a large era value wraps rather than
 *   widening — but the only consumer of the sum is a store, and a store through the memory seam
 *   truncates to a byte on its own. A twin that lets the sum widen is therefore UNOBSERVABLE at
 *   every era, and the arm asserts exactly that. It is recorded as a fact about the seam, not
 *   listed among the teeth, because a twin nothing can catch is not a tooth.
 *
 * GATE: crafted entry, plus an exhaustive sweep of the era cell and of the queue length, plus the
 *   family's permission cross. What it exercises, holes stated:
 *
 *   1. CRAFTED ENTRY — RAM identical outside the scratch window named in 2.
 *   2. THE DEAD SCRATCH IS THE ONE EXCLUSION, PINNED to [SP-6, SP). An upper bound.
 *   3. REGISTERS AND PC ARE EXCLUDED, DELIBERATELY. This entry's add sets flags, so unlike its
 *      siblings the flag byte legitimately moves; the arm pins the set rather than widening it.
 *   4. EXHAUSTIVE over the era cell, 0..255 — both that the arms agree and that the code the
 *      oracle appends is the era plus the offset, wrapped at a byte.
 *   5. A CONTIGUOUS RUN — the five era values the game reaches map to five consecutive codes.
 *   6. GATE CROSS over both permission cells, which is the only coverage of the drop branch.
 *   7. EXHAUSTIVE over the queue length, 0..255.
 *   8. TEETH — four twins the era sweep catches, one the permission cross catches, and one
 *      candidate defect established to be UNCATCHABLE, with the reason.
 *
 * HOLE: WHAT the sounds are. Nothing on this CPU can say; the code is a byte handed to a second
 * processor. This gate fixes which byte and under what permission, and claims nothing more.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-57f7.test.js
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
import { loc_57f7 } from "../loc_57f7.js";
import { loc_560c } from "../loc_560c.js";
import { loc_562a } from "../loc_562a.js";
import { ERA_INDEX, PLAY_ACTIVE } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8 } from "../../../../core/int.js";

const TARGET = 0x57f7;
const TAIL = 0x560c;
const FIRST_ERA_CODE = 12;
const ERAS_IN_PLAY = [0, 1, 2, 3, 4];
const SCRATCH_BYTES = 6;

const skip = romsPresent() ? false : "ROM images are absent from this checkout";
const oracle = oracleAt(TARGET);

function entryState() {
  const e = captureEntry(TAIL);
  assert.notEqual(e, null, "vacuous: the tape never reached the tail either");
  return e;
}

/** Both arms from the base entry, with the era, the permission cells and the length forced. */
function craftedDiff(cand, era, play, demo, length) {
  const entry = entryState();
  const arms = [entry.clone(), entry.clone()];
  for (const s of arms) {
    s.mem8[ERA_INDEX] = era;
    s.mem8[PLAY_ACTIVE] = play;
    s.mem8[DEMO_SOUNDS] = demo;
    s.mem8[QUEUE_LENGTH] = length;
  }
  oracle(arms[0]);
  cand(arms[1]);
  return realDiff(arms[0], arms[1], entry.regs.sp, SCRATCH_BYTES);
}

/** The code the oracle appends for one era, from a state where the request is admitted. */
function codeForEra(era) {
  const s = entryState().clone();
  s.mem8[ERA_INDEX] = era;
  s.mem8[PLAY_ACTIVE] = 0xff;
  s.mem8[QUEUE_LENGTH] = 2;
  oracle(s);
  assert.equal(s.mem8[QUEUE_LENGTH], 3, `era ${era}: the admitted request did not append`);
  return s.mem8[QUEUE_LENGTH + 3];
}

const PLAY_VALUES = [0x00, 0x01, 0xff];
const DEMO_VALUES = [0x00, 0x01];
const CROSS_SIZE = PLAY_VALUES.length * DEMO_VALUES.length;

function eraSweepCaught(cand) {
  let caught = 0;
  for (let era = 0; era < 256; era++) if (craftedDiff(cand, era, 0xff, 0x01, 3)) caught++;
  return caught;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CRAFTED ENTRY: loc_57f7 == oracle on RAM", { skip }, () => {
  const entry = entryState();
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  loc_57f7(b);
  const d = realDiff(a, b, entry.regs.sp, SCRATCH_BYTES);
  assert.equal(d, null, `RAM diverged — ${show(d)}`);
  assert.ok(allDiffs(a, b).length > 0, "no divergence at all — the scratch push vanished");
  console.log(
    `  CRAFTED: entry sp=${hex4(entry.regs.sp)} era=${entry.mem8[ERA_INDEX]} ` +
      `play=${entry.mem8[PLAY_ACTIVE]}; RAM identical outside [SP-${SCRATCH_BYTES}, SP)`,
  );
});

test("EXCLUDED, deliberately: registers, pc and the scratch window and nothing else", { skip }, () => {
  const entry = entryState();
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  loc_57f7(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.deepEqual(
    moved,
    ["a", "f", "sp"],
    "the excluded set changed shape: only the accumulator, the flag byte the add sets, and " +
      "the stack pointer may differ",
  );
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.equal(a.regs.sp - b.regs.sp, 2, "the oracle pops its return address; the rewrite does not");
  const outside = allDiffs(a, b).filter(
    (d) => d.addr < entry.regs.sp - SCRATCH_BYTES || d.addr >= entry.regs.sp,
  );
  assert.deepEqual(outside, [], "a divergence escaped the scratch window");
  console.log(`  EXCLUDED: registers ${moved.join(", ")}, pc, and the scratch window only`);
});

test("EXHAUSTIVE over the era cell: 0..255, arms agree and the code tracks the era", { skip }, () => {
  for (let era = 0; era < 256; era++) {
    const d = craftedDiff(loc_57f7, era, 0xff, 0x01, 3);
    assert.equal(d, null, `era=${era}: ${show(d)}`);
    assert.equal(codeForEra(era), u8(era + FIRST_ERA_CODE), `era=${era}: wrong code appended`);
  }
  console.log("  EXHAUSTIVE: 256 era values identical, including the eight-bit wrap of the sum");
});

test("A CONTIGUOUS RUN: the eras the game reaches map to consecutive codes", { skip }, () => {
  const codes = ERAS_IN_PLAY.map(codeForEra);
  for (let i = 1; i < codes.length; i++) {
    assert.equal(codes[i], codes[i - 1] + 1, "the run must step by exactly one per era");
  }
  assert.equal(new Set(codes).size, codes.length, "no two eras may request the same code");
  console.log(`  RUN: eras ${ERAS_IN_PLAY.join(",")} -> codes ${codes.map(hex4).join(" ")}`);
});

test("GATE CROSS: both permission cells swept, including the drop branch", { skip }, () => {
  for (const play of PLAY_VALUES) {
    for (const demo of DEMO_VALUES) {
      const d = craftedDiff(loc_57f7, 3, play, demo, 3);
      assert.equal(d, null, `play=${play} demo=${demo}: ${show(d)}`);
    }
  }
  console.log(`  GATE CROSS: ${CROSS_SIZE} permission combinations identical`);
});

test("EXHAUSTIVE over the queue length", { skip }, () => {
  for (let length = 0; length < 256; length++) {
    const d = craftedDiff(loc_57f7, 2, 0xff, 0x01, length);
    assert.equal(d, null, `length=${length}: ${show(d)}`);
  }
  console.log("  EXHAUSTIVE: 256 queue lengths identical");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: asks for one fixed sound, ignoring the era — what the sibling entries legitimately do. */
function brokenFixedCode(m) {
  loc_560c(m, FIRST_ERA_CODE);
}

/** BUG: hands the era index over raw, dropping the offset that places the run. */
function brokenNoOffset(m) {
  loc_560c(m, m.mem8[ERA_INDEX]);
}

/** BUG: reads the cell beside the era index, so the sound stops tracking the era. */
function brokenNeighbouringCell(m) {
  loc_560c(m, u8(m.mem8[ERA_INDEX + 1] + FIRST_ERA_CODE));
}

/** Lets the sum widen past a byte instead of wrapping. See the arm below: NOT a catchable bug. */
function widenedSum(m) {
  loc_560c(m, m.mem8[ERA_INDEX] + FIRST_ERA_CODE);
}

/** BUG: asks unconditionally, so the era sound plays with no game in progress. */
function brokenUngated(m) {
  loc_562a(m, u8(m.mem8[ERA_INDEX] + FIRST_ERA_CODE));
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["fixed-code", brokenFixedCode],
  ["no-offset", brokenNoOffset],
  ["neighbouring-cell", brokenNeighbouringCell],
];

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT across the era sweep`, { skip }, () => {
    const caught = eraSweepCaught(twin);
    assert.ok(caught > 0, `the sweep PASSED the ${label} twin — it has no teeth`);
    const first = [...Array(256).keys()].map((e) => craftedDiff(twin, e, 0xff, 0x01, 3)).find(Boolean);
    console.log(`  TEETH/${label}: caught on ${caught}/256 eras — first ${show(first)}`);
  });
}

test("NOT A CATCHABLE BUG: the byte wrap is enforced by the memory seam, not by this routine", { skip }, () => {
  const caught = eraSweepCaught(widenedSum);
  assert.equal(
    caught,
    0,
    "a widened sum WAS discriminated, which would mean the seam no longer truncates on write " +
      "and the explicit wrap in the routine is load-bearing after all — re-read this arm",
  );
  const s = entryState().clone();
  s.mem8[ERA_INDEX] = 0xfe;
  s.mem8[PLAY_ACTIVE] = 0xff;
  s.mem8[QUEUE_LENGTH] = 2;
  s.mem8[QUEUE_LENGTH + 3] = 0xfe + FIRST_ERA_CODE;
  assert.equal(s.mem8[QUEUE_LENGTH + 3], u8(0xfe + FIRST_ERA_CODE), "the write must truncate");
  console.log(
    "  NOT CATCHABLE: a store through the memory seam truncates to a byte, so widening the sum " +
      "is unobservable — the routine's explicit wrap is defensive, not behaviour",
  );
});

test("TEETH: the ungated twin is INVISIBLE while a game is in progress", { skip }, () => {
  assert.equal(
    craftedDiff(brokenUngated, 3, 0xff, 0x01, 3),
    null,
    "with the play flag set the ungated twin must behave identically, or this arm proves nothing",
  );
  assert.ok(
    craftedDiff(brokenUngated, 3, 0x00, 0x00, 3),
    "with both permission cells clear it must diverge",
  );
  console.log("  TEETH/ungated: blind in play, caught only with the permission cells clear");
});

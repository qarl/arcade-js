// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1393 — memory-equivalent to the frozen oracle at ROM 0x1393.
 *
 * GATE: crafted-entry with NO exclusion at all — the frozen routine pushes nothing, so the whole
 *   state dump compares byte-identical. The strict gate CANNOT run here: neither the shared
 *   coin -> start tape nor an undriven session dispatches 0x1393 in two thousand frames, so
 *   unitEquivalence throws "never entered" and the first arm ASSERTS that throw. The entry is
 *   BUILT instead: a real machine, cloned at the end of the tape's session, with only the two
 *   cells this routine reads forced.
 *
 * What it exercises, holes stated:
 *   1. UNREACHED — measured on both sessions, not assumed.
 *   2. NOT VACUOUS — an empty candidate FAILS the crafted comparison.
 *   3. EXCLUDED — the register divergence pinned to a measured set.
 *   4. EXHAUSTIVE — every one of 256 countdown values against five priors of the attribute byte,
 *      which is the WHOLE of the routine's input space. This is the arm that matters most here,
 *      because the rewrite COLLAPSES a five-armed ladder into one test of one bit: if that
 *      collapse were wrong at any count, this arm is where it would show.
 *   5. THE COUNT STILL STEPS AT ZERO — asserted, because a countdown that stopped at zero rather
 *      than wrapping below it would agree with the rewrite everywhere else.
 *   6. THE MIRRORING BITS SURVIVE — asserted from a prior that has them set.
 *   7. TEETH — seven twins, each caught on an exact count of crafted entries. The two about the
 *      zero frame score five, one per attribute prior, and that IS the shape of the routine: only
 *      the single count of 256 that reads zero can tell those two apart from the rewrite.
 *
 * HOLE: one backdrop. Every cell but the two read ones is what the session left, which cannot
 * matter because nothing else is read.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-1393.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_1393 } from "../loc_1393.js";
import { loc_1393 as oracle } from "../../translated/loc_1393.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8 } from "../../../../core/int.js";

const TARGET = 0x1393;
const skip = romsPresent() ? false : "ROM images are gitignored and absent";

const ANIMATION_STEP = 0xa9f0;
const COUNTDOWN = 0xa9f3;
const SPRITE_ATTRIBUTE = 0xaa40;
const MIRROR_BITS = 0xc0;
const ALTERNATING_BIT = 0x04;
const FIRST_COLOUR = 63;
const SECOND_COLOUR = 55;
const NEXT_STEP = 3;

const CORPUS_FRAMES = 2000;
const TAPES = [["shared", {}], ["attract", { tape: [] }]];
const EXCLUDED = ["f", "b", "sp"];

const ATTRIBUTES = [0x00, 0xff, 0xc0, 0x3f, 0x81];
/** A point on the arm that also moves the step cell. */
const LIVE_POINT = [0, 0xff];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: frozen=${d.a} candidate=${d.b}` : "identical");

// ── the session, and the entry built off it ─────────────────────────────────────────────

let session = null;
function sessionRun() {
  if (session) return session;
  let host = null;
  let threw = null;
  try {
    unitEquivalence((overrides) => (host = makeMachine(overrides)), TARGET, oracle, loc_1393, {
      maxFrames: ENTRY_FRAMES,
    });
  } catch (e) {
    threw = e;
  }
  session = { host, threw };
  return session;
}

let pristineEntry = null;
function pristine() {
  if (!pristineEntry) pristineEntry = sessionRun().host.clone();
  return pristineEntry;
}

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b)[0] ?? null;
}

function craft([remaining, attribute]) {
  const m = pristine().clone();
  m.mem8[COUNTDOWN] = remaining;
  m.mem8[SPRITE_ATTRIBUTE] = attribute;
  return m;
}

const POINTS = [];
for (let remaining = 0; remaining < 256; remaining++) {
  for (const a of ATTRIBUTES) POINTS.push([remaining, a]);
}

function sweepCaught(candidate) {
  let caught = 0;
  for (const spec of POINTS) if (unitDiff(candidate, craft(spec))) caught++;
  return caught;
}

function dispatchCount(opts) {
  let dispatches = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => (dispatches++, oracle(mm))]]), opts);
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return dispatches;
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

function frame(m, {
  mask = MIRROR_BITS, bit = ALTERNATING_BIT, first = FIRST_COLOUR, second = SECOND_COLOUR,
  step = true, count = true, stopAtZero = false,
} = {}) {
  const { mem8 } = m;
  const remaining = mem8[COUNTDOWN];
  if (step && remaining === 0) mem8[ANIMATION_STEP] = NEXT_STEP;
  const colour = (remaining & bit) === 0 ? first : second;
  mem8[SPRITE_ATTRIBUTE] = (mem8[SPRITE_ATTRIBUTE] & mask) + colour;
  if (count && !(stopAtZero && remaining === 0)) mem8[COUNTDOWN] = u8(remaining - 1);
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the colour is written whole, so the mirroring bits are wiped. */
function brokenWipesTheMirrorBits(m) {
  frame(m, { mask: 0x00 });
}

/** BUG: the two colours swap, so the animation runs in antiphase. */
function brokenSwapsTheColours(m) {
  frame(m, { first: SECOND_COLOUR, second: FIRST_COLOUR });
}

/** BUG: the count is never stepped. */
function brokenDoesNotCount(m) {
  frame(m, { count: false });
}

/** BUG: the count stops at zero instead of wrapping below it. */
function brokenClampsAtZero(m) {
  frame(m, { stopAtZero: true });
}

/** BUG: the step cell is never moved on. */
function brokenNeverMovesTheStep(m) {
  frame(m, { step: false });
}

/** BUG: the colour alternates on the neighbouring bit, so it holds half as long. */
function brokenWrongAlternatingBit(m) {
  frame(m, { bit: 0x02 });
}

const TWINS = [
  ["no-op", brokenNoOp, 1280],
  ["wipes-the-mirror-bits", brokenWipesTheMirrorBits, 768],
  ["swaps-the-colours", brokenSwapsTheColours, 1280],
  ["does-not-count", brokenDoesNotCount, 1280],
  ["clamps-at-zero", brokenClampsAtZero, 5],
  ["never-moves-the-step", brokenNeverMovesTheStep, 5],
  ["wrong-alternating-bit", brokenWrongAlternatingBit, 640],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: the strict gate CANNOT run here, and both sessions confirm it", { skip }, () => {
  assert.notEqual(sessionRun().threw, null, "the shared tape now reaches this routine, so the " +
    "strict unit-capture gate is available and this file should use it");
  assert.match(String(sessionRun().threw), /never entered/, "the harness failed for another reason");
  for (const [label, opts] of TAPES) {
    assert.equal(dispatchCount(opts), 0, `the ${label} session now dispatches this routine`);
  }
  console.log(
    `  UNREACHED: neither of ${TAPES.length} sessions of ${CORPUS_FRAMES} frames dispatches it; ` +
      `the entry is a real machine at sp=${hex4(pristine().regs.sp)} with its two inputs forced`,
  );
});

test("NOT VACUOUS: a candidate that does nothing FAILS the crafted comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft(LIVE_POINT));
  assert.notEqual(d, null, "the comparison passed an empty candidate, so it measures nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: registers and pc, and nothing else", { skip }, () => {
  const a = craft(LIVE_POINT);
  const b = a.clone();
  oracle(a);
  loc_1393(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    EXCLUDED,
    "the excluded set changed shape",
  );
  assert.notEqual(a.pc, b.pc, "the frozen routine's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc`);
});

test("EXHAUSTIVE: every count against five attribute priors, the whole input space", { skip }, () => {
  assert.equal(sweepCaught(loc_1393), 0, "the rewrite diverged somewhere in the crafted space");
  const colours = new Set();
  for (let remaining = 0; remaining < 256; remaining++) {
    const m = craft([remaining, 0x00]);
    oracle(m);
    colours.add(m.mem8[SPRITE_ATTRIBUTE]);
  }
  assert.deepEqual(
    [...colours].sort((x, y) => x - y),
    [SECOND_COLOUR, FIRST_COLOUR],
    "the frozen routine produces a set of colours the rewrite's single test cannot reproduce, " +
      "so the collapse of its ladder is not sound and must be re-derived",
  );
  console.log(
    `  EXHAUSTIVE: ${POINTS.length} crafted entries identical; over all 256 counts the frozen ` +
      `routine leaves exactly ${[...colours].sort((x, y) => x - y).join(" and ")}`,
  );
});

test("THE COUNT STILL STEPS AT ZERO: it wraps below rather than stopping", { skip }, () => {
  const m = craft([0, 0x00]);
  loc_1393(m);
  assert.equal(m.mem8[COUNTDOWN], 255, "the count did not wrap below zero");
  assert.equal(m.mem8[ANIMATION_STEP], NEXT_STEP, "the step cell was not moved on at zero");
  console.log("  AT ZERO: the count wraps to 255 and the step cell moves on, both in one frame");
});

test("THE MIRRORING BITS SURVIVE: both are kept from a prior that has them set", { skip }, () => {
  const m = craft([4, 0xff]);
  loc_1393(m);
  assert.equal(m.mem8[SPRITE_ATTRIBUTE] & MIRROR_BITS, MIRROR_BITS, "the mirroring bits were lost");
  assert.equal(m.mem8[SPRITE_ATTRIBUTE] & ~MIRROR_BITS, SECOND_COLOUR, "the colour is wrong");
  console.log(`  MIRRORING: 0xff -> ${hex4(m.mem8[SPRITE_ATTRIBUTE])}, top two bits intact`);
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `the ${label} twin's catch count moved`);
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${POINTS.length} crafted entries`);
  });
}

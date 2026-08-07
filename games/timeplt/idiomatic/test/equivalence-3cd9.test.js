// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_3cd9 — memory-equivalent to the frozen oracle at ROM 0x3CD9.
 *
 * GATE: strict unit-capture with NO exclusion — the frozen routine pushes nothing and writes
 *   nothing — PLUS a live-out comparison on the carry flag, an EXHAUSTIVE sweep of the routine's
 *   entire input space, and teeth.
 *
 *   THE ANSWER, NOT THE MEMORY, IS THE CONTRACT. This routine writes no cell at all, so a RAM
 *   diff alone would pass a candidate that returned the opposite answer every time. The first
 *   arm measures that rather than asserting it: the always-wrong twin is RAM-identical.
 *
 * What it exercises, holes stated:
 *   1. EQUAL at the real dispatch — the whole dump, stack included, AND the carry flag. The
 *      first dispatch lands past the shared entry budget, which is asserted rather than worked
 *      around silently.
 *   2. RAM IS BLIND — measured, with the inverted twin, so the live-out arm is known to be the
 *      only thing holding this routine to its answer.
 *   3. CORPUS — every dispatch of the UNDRIVEN session. The driven tape never reaches this
 *      routine, which is asserted, and is why the corpus is taken from attract.
 *   4. EXCLUDED — the register divergence pinned to a measured set.
 *   5. EXHAUSTIVE — the whole input space is the two coordinate bytes of one sprite entry:
 *      all 65536 pairs, comparing the carry the frozen routine leaves against the carry AND the
 *      returned boolean. Both windows are covered, including the one the second test owns.
 *   6. TEETH — seven twins, each caught on an exact count of the 65536 pairs. Only the inverted
 *      one is caught everywhere; the rest score in the hundreds or low thousands, because the
 *      answer is true on a narrow band and two candidates that disagree about the band still
 *      agree over most of the plane. Those counts are the shape of the routine, not a score, and
 *      the lowest of them belongs to the twin whose band differs from the right one by one.
 *
 * HOLE: the exhaustive arm reuses two machines rather than cloning per point, so it compares the
 * answer and not RAM. A separate arm cross-checks a thousand of those points with clone-per-point
 * whole-dump comparison, which is what says the reuse is not hiding a write.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3cd9.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_3cd9 } from "../loc_3cd9.js";
import { loc_3cd9 as oracle } from "../../translated/loc_3cd9.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS, F_C } from "../../../../core/cpu/z80.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x3cd9;
const skip = romsPresent() ? false : "ROM images are gitignored and absent";

const FIRST_COORDINATE = 0x00;
const SECOND_COORDINATE = 0x31;
/** The two windows: the second coordinate's, decided here, and the first's, decided downstream. */
const SECOND_BAND = 3;
const SECOND_STARTS_BELOW_WRAP = 16;
const FIRST_BAND = 4;
const FIRST_STARTS_BELOW_WRAP = 2;

const CORPUS_FRAMES = 2000;
const ATTRACT = { tape: [] };
/**
 * The shared entry budget is not enough here: the first dispatch of the undriven session lands
 * at frame 1902, past it. The budget is raised locally, and the arm below asserts that the
 * shared one really does fall short, so this is a measured need rather than a habit.
 */
const REACH_FRAMES = 2000;
/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { attract: 100, shared: 0 };

const EXCLUDED = ["a", "f", "sp"];
const SWEEP_SIZE = 256 * 256;
const CROSS_CHECK_POINTS = 1000;

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: frozen=${d.a} candidate=${d.b}` : "identical");
const carry = (m) => (m.regs.f & F_C) !== 0;

// ── the entry ───────────────────────────────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    (overrides) => makeMachine(overrides, ATTRACT),
    TARGET,
    oracle,
    (m) => {
      if (entry === null) entry = m.clone();
      return candidate(m);
    },
    { maxFrames: REACH_FRAMES },
  );
}

function entryState() {
  if (entry === null) gate(loc_3cd9);
  return entry;
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

/** RAM, then the carry the answer is mirrored into. Clone per point. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b)[0];
  if (ram) return ram;
  if (carry(a) !== carry(b)) return { addr: null, a: carry(a), b: carry(b) };
  return null;
}

// ── the exhaustive sweep, on two reused machines ────────────────────────────────────────

let arena = null;
function pair() {
  if (!arena) arena = [entryState().clone(), entryState().clone()];
  return arena;
}

/**
 * One point of the sweep. Both machines are reset to the same coordinates and stack pointer
 * before each run, which is sound here BECAUSE the routine writes nothing — a claim the
 * cross-check arm below tests rather than takes on trust.
 */
function answerDiffers(candidate, first, second) {
  const [a, b] = pair();
  const sp = entryState().regs.sp;
  const iy = entryState().regs.iy;
  for (const m of [a, b]) {
    m.regs.iy = iy;
    m.regs.sp = sp;
    m.mem8[u16(iy + FIRST_COORDINATE)] = first;
    m.mem8[u16(iy + SECOND_COORDINATE)] = second;
  }
  oracle(a);
  const returned = candidate(b);
  if (carry(a) !== carry(b)) return true;
  return returned !== undefined && returned !== carry(a);
}

function sweepCaught(candidate) {
  let caught = 0;
  for (let first = 0; first < 256; first++) {
    for (let second = 0; second < 256; second++) {
      if (answerDiffers(candidate, first, second)) caught++;
    }
  }
  return caught;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  const answers = new Set();
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      if (unitDiff(candidate, mm)) caught++;
      const probe = mm.clone();
      oracle(probe);
      answers.add(carry(probe));
      return oracle(mm);
    }]]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, answers };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

const answerOf = (m, first, second) => {
  void m;
  return u8(second + SECOND_STARTS_BELOW_WRAP) < SECOND_BAND ||
    u8(first + FIRST_STARTS_BELOW_WRAP) < FIRST_BAND;
};

function reply(m, value) {
  m.regs.f = (m.regs.f & ~F_C) | (value ? F_C : 0);
  return value;
}

const coordinates = (m) => [
  m.mem8[u16(m.regs.iy + FIRST_COORDINATE)],
  m.mem8[u16(m.regs.iy + SECOND_COORDINATE)],
];

/** BUG: does nothing at all, so the carry it leaves is whatever the caller had. */
function brokenNoOp() {}

/** BUG: the answer is always the opposite. */
function brokenInverted(m) {
  const [first, second] = coordinates(m);
  return reply(m, !answerOf(m, first, second));
}

/** BUG: only the coordinate this entry owns is tested; the second test is dropped. */
function brokenDropsTheSecondTest(m) {
  const [, second] = coordinates(m);
  return reply(m, u8(second + SECOND_STARTS_BELOW_WRAP) < SECOND_BAND);
}

/** BUG: only the coordinate the DOWNSTREAM test owns is tested. */
function brokenDropsTheFirstTest(m) {
  const [first] = coordinates(m);
  return reply(m, u8(first + FIRST_STARTS_BELOW_WRAP) < FIRST_BAND);
}

/** BUG: this entry's band is one wider. */
function brokenBandTooWide(m) {
  const [first, second] = coordinates(m);
  const arrived = u8(second + SECOND_STARTS_BELOW_WRAP) < SECOND_BAND + 1;
  return reply(m, arrived || u8(first + FIRST_STARTS_BELOW_WRAP) < FIRST_BAND);
}

/** BUG: this entry's band sits at the wrap rather than short of it. */
function brokenBandAtTheWrap(m) {
  const [first, second] = coordinates(m);
  const arrived = u8(second + FIRST_STARTS_BELOW_WRAP) < SECOND_BAND;
  return reply(m, arrived || u8(first + FIRST_STARTS_BELOW_WRAP) < FIRST_BAND);
}

/** BUG: the two coordinates are read out of each other's slot. */
function brokenSwapsTheAxes(m) {
  const [first, second] = coordinates(m);
  const arrived = u8(first + SECOND_STARTS_BELOW_WRAP) < SECOND_BAND;
  return reply(m, arrived || u8(second + FIRST_STARTS_BELOW_WRAP) < FIRST_BAND);
}

const TWINS = [
  ["no-op", brokenNoOp, 1780],
  ["inverted", brokenInverted, 65536],
  ["drops-the-second-test", brokenDropsTheSecondTest, 1012],
  ["drops-the-first-test", brokenDropsTheFirstTest, 756],
  ["band-too-wide", brokenBandTooWide, 252],
  ["band-at-the-wrap", brokenBandAtTheWrap, 1512],
  ["swaps-the-axes", brokenSwapsTheAxes, 3510],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("THE SHARED ENTRY BUDGET FALLS SHORT, which is why this file raises it", { skip }, () => {
  assert.throws(
    () => unitEquivalence((ov) => makeMachine(ov, ATTRACT), TARGET, oracle, loc_3cd9, {
      maxFrames: ENTRY_FRAMES,
    }),
    /never entered/,
    "the shared entry budget now reaches this routine, so the local budget is unnecessary",
  );
  console.log(`  BUDGET: ${ENTRY_FRAMES} frames never reach it; ${REACH_FRAMES} do`);
});

test("EQUAL at the real dispatch: the whole dump and the carry", { skip }, () => {
  const r = gate(loc_3cd9);
  assert.notEqual(entry, null, "vacuous: the undriven session never reached the routine");
  assert.equal(r.ram, null, `a byte diverged — ${show(r.ram)}`);
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  const returned = loc_3cd9(b);
  assert.equal(carry(a), carry(b), "the carry the answer rides in diverged");
  assert.equal(returned, carry(a), "the returned boolean disagrees with the carry");
  const e = entryState();
  console.log(
    `  EQUAL: entry slot=${hex4(e.regs.iy)} first=${e.mem8[e.regs.iy]} ` +
      `second=${e.mem8[u16(e.regs.iy + SECOND_COORDINATE)]}; answer=${carry(a)}`,
  );
});

test("RAM IS BLIND: an always-wrong candidate leaves the dump identical", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  brokenInverted(b);
  assert.deepEqual(allDiffs(a, b), [], "the inverted twin now moves a byte, so RAM is no longer " +
    "blind here and this file's account of what the gate rests on must be re-derived");
  assert.notEqual(carry(a), carry(b), "the inverted twin must differ where RAM cannot see");
  console.log("  RAM IS BLIND: the inverted twin is dump-identical; only the carry separates them");
});

test("CORPUS: the undriven session's every dispatch; the driven tape reaches none", { skip }, () => {
  const undriven = replaySession(ATTRACT, loc_3cd9);
  assert.equal(undriven.dispatches, DISPATCHES.attract, "the undriven dispatch count moved");
  assert.equal(undriven.caught, 0, `the rewrite diverged on ${undriven.caught} dispatches`);
  const driven = replaySession({}, loc_3cd9);
  assert.equal(driven.dispatches, DISPATCHES.shared, "the driven tape now reaches this routine, " +
    "so the corpus should be taken from it as well");
  console.log(
    `  CORPUS: ${undriven.dispatches} undriven dispatches identical, answers seen ` +
      `${[...undriven.answers].join("/")}; the driven tape reaches none`,
  );
});

test("EXCLUDED, deliberately: registers and pc, and nothing else", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_3cd9(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    EXCLUDED,
    "the excluded set changed shape",
  );
  assert.notEqual(a.pc, b.pc, "the frozen routine's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc — the carry inside f is compared apart`);
});

test("EXHAUSTIVE: all 65536 coordinate pairs give the same answer", { skip }, () => {
  assert.equal(sweepCaught(loc_3cd9), 0, "the rewrite answered differently somewhere");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} coordinate pairs, carry and return identical`);
});

test("THE REUSED MACHINES ARE SOUND: clone-per-point agrees on a sample", { skip }, () => {
  let checked = 0;
  for (let i = 0; i < CROSS_CHECK_POINTS; i++) {
    const first = (i * 61) & 0xff;
    const second = (i * 37) & 0xff;
    const m = entryState().clone();
    m.mem8[u16(m.regs.iy + FIRST_COORDINATE)] = first;
    m.mem8[u16(m.regs.iy + SECOND_COORDINATE)] = second;
    assert.equal(unitDiff(loc_3cd9, m), null, `clone-per-point diverged at ${first},${second}`);
    assert.equal(
      answerDiffers(loc_3cd9, first, second),
      false,
      `the reused arena disagrees with clone-per-point at ${first},${second}`,
    );
    checked++;
  }
  assert.equal(checked, CROSS_CHECK_POINTS, "the cross-check ran short");
  console.log(`  CROSS-CHECK: ${checked} points agree between the arena and clone-per-point`);
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of coordinate pairs`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `the ${label} twin's catch count moved`);
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${SWEEP_SIZE} pairs`);
  });
}

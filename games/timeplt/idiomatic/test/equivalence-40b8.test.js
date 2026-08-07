// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_40b8 — memory-equivalent to the frozen oracle at ROM 0x40B8.
 *
 * GATE: strict unit-capture, a corpus replay of a whole driven session, and a crafted cross over
 *   every cell the routine reads. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — the state dump agrees byte for byte, the stack scratch
 *      INCLUDED, and that is asserted rather than masked: no real dispatch takes the asking arm,
 *      so nothing pushes and the exclusion named below buys nothing there.
 *   2. BLIND AT THE CAPTURE, MEASURED. The captured dispatch takes one of the four refusing arms,
 *      so the frozen routine moves nothing there and a no-op passes. That is asserted, not
 *      described, and it is why the crafted cross is what carries this gate.
 *   3. CROSS — every era value 0..7 against a set of counter values that straddles the one value
 *      the counter test admits, against every pattern of the three watched bytes. Each is poked
 *      identically on both sides, and compared outside a six-byte dead scratch window below the
 *      entry stack pointer: the asking arm reaches a frozen request chain that brackets its work
 *      with pushes, and the stack-free rewrite makes none. Measured as an upper bound, and every
 *      arm asserts that no divergence escapes it.
 *   4. BOTH OUTCOMES REACHED, asserted: the cross is shown to contain entries where the frozen
 *      routine asks for the sound and entries where it does not, and the two sets are disjoint.
 *   5. CORPUS — every dispatch of a driven session, on a clone taken at the dispatch, with the
 *      outcomes the session actually reached reported rather than assumed.
 *   6. TEETH — seven twins, one per test the entry makes plus a no-op and an unconditional
 *      ask, each caught on its own exact count.
 *
 * HOLE: the request itself is somebody else's gate. What this file fixes is WHEN the request goes
 * out; whether the right sound goes out, and under what further permission, is not tested here and
 * the twins deliberately do not attack it.
 * HOLE: the corpus reaches only the eras the driven session reaches, which the arm reports.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-40b8.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_40b8 } from "../loc_40b8.js";
import { loc_40b8 as oracle } from "../../translated/loc_40b8.js";
import { ERA_INDEX, FRAME_TICK } from "../names.js";
import { loc_5679 } from "../loc_5679.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x40b8;
const WATCHED = [0xa8c0, 0xa8d0, 0xa8e0];
const ALL_ONES = 255;

/**
 * The dead stack scratch the asking arm dirties: the frozen request chain brackets its work with
 * pushes the stack-free rewrite does not make. Measured as an upper bound over the whole cross;
 * no real dispatch dirties anything, which the first arm asserts.
 */
const SCRATCH_BYTES = 6;

/** Dispatches the shared tape produces in the harness budget. Measured; a move is a finding. */
const DISPATCHES = 303;

const skip = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr)}: oracle=${d.a} candidate=${d.b}` : "identical");

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** Those divergences falling OUTSIDE the dead scratch window below the entry stack pointer. */
function outsideScratch(a, b, sp) {
  return allDiffs(a, b).filter((d) => d.addr < sp - SCRATCH_BYTES || d.addr >= sp);
}

function compare(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return outsideScratch(a, b, sp)[0] ?? null;
}

let captured = null;

function replay(candidate) {
  let dispatches = 0;
  let caught = 0;
  let asked = 0;
  const eras = new Set();
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    eras.add(mm.mem8[ERA_INDEX]);
    if (captured === null) captured = mm.clone();
    if (compare(candidate, mm)) caught++;
    const probe = mm.clone();
    oracle(probe);
    if (allDiffs(mm, probe).length > 0) asked++;
    return oracle(mm);
  }]]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  return { dispatches, caught, asked, eras };
}

function entryState() {
  if (captured === null) replay(loc_40b8);
  return captured;
}

/** A real captured machine with every cell the routine reads forced. */
function craft(era, counter, pattern) {
  const m = entryState().clone();
  m.mem8[ERA_INDEX] = era;
  m.mem8[FRAME_TICK] = counter;
  WATCHED.forEach((cell, i) => {
    m.mem8[cell] = pattern & (1 << i) ? ALL_ONES : 0x10 + i;
  });
  return m;
}

const ERAS = [0, 1, 2, 3, 4, 5, 6, 7];
const COUNTERS = [0, 1, 16, 31, 32, 48, 63, 64, 128, 224, 255];
const PATTERNS = [0, 1, 2, 3, 4, 5, 6, 7];
const CROSS_SIZE = ERAS.length * COUNTERS.length * PATTERNS.length;

function eachCrossEntry(body) {
  for (const era of ERAS) {
    for (const counter of COUNTERS) {
      for (const pattern of PATTERNS) body(era, counter, pattern);
    }
  }
}

function crossCaught(candidate) {
  let caught = 0;
  eachCrossEntry((era, counter, pattern) => {
    if (compare(candidate, craft(era, counter, pattern))) caught++;
  });
  return caught;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: every byte identical, the stack scratch included", { skip }, () => {
  const entry = entryState();
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  loc_40b8(b);
  assert.deepEqual(
    allDiffs(a, b),
    [],
    `a byte diverged at the real dispatch — ${show(allDiffs(a, b)[0])}`,
  );
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    ["f", "sp"],
    "the excluded set changed shape: neither of these outlives the entry",
  );
  console.log(
    `  EQUAL: era ${entry.mem8[ERA_INDEX]}, counter ${entry.mem8[FRAME_TICK]}; identical`,
  );
});

test("BLIND AT THE CAPTURE: the captured dispatch refuses, so a no-op passes it", { skip }, () => {
  const entry = entryState();
  const refuses =
    entry.mem8[ERA_INDEX] < 2 ||
    entry.mem8[FRAME_TICK] % 32 !== 0 ||
    WATCHED.some((cell) => entry.mem8[cell] === ALL_ONES);
  assert.equal(refuses, true, "the captured dispatch now takes the asking arm, so re-derive this file");
  assert.equal(
    compare(() => {}, entry),
    null,
    "the no-op is now CAUGHT at the captured dispatch — good news, but this file documents the " +
      "opposite and must be rewritten",
  );
  console.log("  BLIND AT THE CAPTURE: the captured dispatch refuses; a no-op passes there");
});

test("CROSS: every era x counter x watched-pattern behaves alike", { skip }, () => {
  eachCrossEntry((era, counter, pattern) => {
    const d = compare(loc_40b8, craft(era, counter, pattern));
    assert.equal(d, null, `era=${era} counter=${counter} pattern=${pattern}: ${show(d)}`);
  });
  console.log(`  CROSS: ${CROSS_SIZE} combinations identical`);
});

test("BOTH OUTCOMES REACHED: the cross contains asking and refusing entries", { skip }, () => {
  let asked = 0;
  let refused = 0;
  eachCrossEntry((era, counter, pattern) => {
    const before = craft(era, counter, pattern);
    const after = before.clone();
    oracle(after);
    if (allDiffs(before, after).length > 0) asked++;
    else refused++;
  });
  assert.ok(asked > 0, "no cross entry reached the asking arm, so the teeth below prove nothing");
  assert.ok(refused > 0, "every cross entry asked, so the four refusing tests are uncovered");
  assert.equal(asked + refused, CROSS_SIZE, "the two outcomes must partition the cross");
  console.log(`  OUTCOMES: ${asked} cross entries ask, ${refused} refuse`);
});

test("CORPUS: every dispatch of a driven session replays identically", { skip }, () => {
  const r = replay(loc_40b8);
  assert.equal(r.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(r.caught, 0, `the rewrite diverged on ${r.caught} real dispatches`);
  console.log(
    `  CORPUS: ${r.dispatches} dispatches identical; eras ${[...r.eras].join(",")}, ` +
      `${r.asked} of them asked`,
  );
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────
// Each twin is a standalone rewrite with exactly one of the four tests wrong, asking through the
// same request the real entry asks through, so what a catch measures is the test and not the ask.

/** BUG: does nothing at all, so the sound is never asked for. */
const brokenNoOp = () => {};

/** BUG: asks unconditionally — no test at all. */
const brokenAsksAlways = (m) => loc_5679(m);

/** BUG: the era threshold is one out, so an era too early asks. */
function brokenEraOffByOne(m) {
  const { mem8 } = m;
  if (mem8[ERA_INDEX] < 1) return;
  if (mem8[FRAME_TICK] % 32 !== 0) return;
  if (WATCHED.some((cell) => mem8[cell] === ALL_ONES)) return;
  loc_5679(m);
}

/** BUG: the counter test admits twice as many values, so it asks twice as often. */
function brokenAsksTwiceAsOften(m) {
  const { mem8 } = m;
  if (mem8[ERA_INDEX] < 2) return;
  if (mem8[FRAME_TICK] % 16 !== 0) return;
  if (WATCHED.some((cell) => mem8[cell] === ALL_ONES)) return;
  loc_5679(m);
}

/** BUG: only the first of the three watched bytes is tested. */
function brokenChecksOneWatchedByte(m) {
  const { mem8 } = m;
  if (mem8[ERA_INDEX] < 2) return;
  if (mem8[FRAME_TICK] % 32 !== 0) return;
  if (mem8[WATCHED[0]] === ALL_ONES) return;
  loc_5679(m);
}

/** BUG: the watched test is inverted — it asks only when one of them IS all-ones. */
function brokenWatchedInverted(m) {
  const { mem8 } = m;
  if (mem8[ERA_INDEX] < 2) return;
  if (mem8[FRAME_TICK] % 32 !== 0) return;
  if (!WATCHED.some((cell) => mem8[cell] === ALL_ONES)) return;
  loc_5679(m);
}

/** BUG: the counter test is dropped, so it asks on every frame of a late era. */
function brokenIgnoresTheCounter(m) {
  const { mem8 } = m;
  if (mem8[ERA_INDEX] < 2) return;
  if (WATCHED.some((cell) => mem8[cell] === ALL_ONES)) return;
  loc_5679(m);
}

const TWINS = [
  ["no-op", brokenNoOp, 30],
  ["asks-always", brokenAsksAlways, 674],
  ["era-off-by-one", brokenEraOffByOne, 5],
  ["asks-twice-as-often", brokenAsksTwiceAsOften, 12],
  ["checks-one-watched-byte", brokenChecksOneWatchedByte, 90],
  ["watched-inverted", brokenWatchedInverted, 240],
  ["ignores-the-counter", brokenIgnoresTheCounter, 36],
];

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of the cross`, { skip }, () => {
    assert.equal(crossCaught(twin), expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${CROSS_SIZE} cross entries`);
  });
}

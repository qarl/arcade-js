// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_172a — memory-equivalent to the frozen oracle at ROM 0x172A.
 *
 * GATE: strict unit-capture through unitEquivalence, on the real dispatch the shared
 *   coin -> start tape produces when the start press is taken. The routine reads nothing
 *   and writes two constants, so its whole input space is the prior content of those two
 *   cells; the EXHAUSTIVE arm sweeps both across 0..255 together, which is the strongest
 *   statement available about a routine with no inputs.
 *
 *   1. EQUAL      — RAM byte-identical across the whole state dump at the real dispatch.
 *   2. STORES     — the two cells really hold the two constants afterwards, whatever they
 *                   held before, so the comparison is not agreeing on a no-change.
 *   3. EXCLUDED   — registers and pc diverge by design; the moved set is pinned.
 *   4. EXHAUSTIVE — both priors swept 0..255, in step and crossed.
 *   5. TEETH      — broken twins, each caught by that sweep.
 *   6. BLIND SPOT — the one dispatch the tape produces has the phase cell already one
 *                   below the constant this routine stores, so AT THAT ENTRY setting and
 *                   stepping land on the same value and the strict comparison cannot tell
 *                   them apart. That arm asserts the blindness rather than leaving it
 *                   implied, and fails loudly if the captured entry ever moves.
 *
 * HOLE: one captured machine. Only the two cells are varied; the rest of RAM is whatever
 * the captured frame left, and it does not matter here because nothing else is read.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-172a.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_172a } from "../loc_172a.js";
import { SEQUENCE_PHASE, SEQUENCE_SUBSTEP } from "../names.js";
import { loc_172a as oracle } from "../../translated/loc_172a.js";
import { firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x172a;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const LAST_PHASE = 3;

let entry = null;

function strict(candidate) {
  return unitEquivalence(
    makeMachine,
    TARGET,
    oracle,
    (m) => {
      if (entry === null) entry = m.clone();
      return candidate(m);
    },
    { maxFrames: ENTRY_FRAMES },
  );
}

function entryState() {
  if (entry === null) strict(loc_172a);
  return entry;
}

/** Oracle vs candidate from the real entry, with both cells forced to given priors. */
function sweepDiff(candidate, phase, substep) {
  const a = entryState().clone();
  const b = entryState().clone();
  for (const mm of [a, b]) {
    mm.mem8[SEQUENCE_PHASE] = phase;
    mm.mem8[SEQUENCE_SUBSTEP] = substep;
  }
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
}

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

// ── broken twins ────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: steps the phase instead of setting it, which is the neighbouring routine's job. */
function brokenSteps(m) {
  const { mem8 } = m;
  mem8[SEQUENCE_PHASE] = mem8[SEQUENCE_PHASE] + 1;
  mem8[SEQUENCE_SUBSTEP] = 0;
}

/** BUG: enters the right phase but leaves the inner index where it was. */
function brokenKeepsSubStep(m) {
  m.mem8[SEQUENCE_PHASE] = LAST_PHASE;
}

/** BUG: off by one in the phase constant. */
function brokenWrongPhase(m) {
  const { mem8 } = m;
  mem8[SEQUENCE_PHASE] = LAST_PHASE - 1;
  mem8[SEQUENCE_SUBSTEP] = 0;
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["steps-instead", brokenSteps],
  ["keeps-substep", brokenKeepsSubStep],
  ["wrong-phase", brokenWrongPhase],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: loc_172a == oracle on RAM", { skip }, () => {
  const r = strict(loc_172a);
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const e = entryState();
  console.log(
    `  EQUAL: entry phase=${e.mem8[SEQUENCE_PHASE]} substep=${e.mem8[SEQUENCE_SUBSTEP]}; ` +
      "RAM identical",
  );
});

test("STORES: both cells really carry the constants afterwards", { skip }, () => {
  const mm = entryState().clone();
  mm.mem8[SEQUENCE_PHASE] = 0xa5;
  mm.mem8[SEQUENCE_SUBSTEP] = 0x5a;
  loc_172a(mm);
  assert.equal(mm.mem8[SEQUENCE_PHASE], LAST_PHASE, "the phase cell was not entered");
  assert.equal(mm.mem8[SEQUENCE_SUBSTEP], 0, "the inner index was not restarted");
  console.log(`  STORES: phase -> ${LAST_PHASE}, inner index -> 0, from arbitrary priors`);
});

test("EXCLUDED, deliberately: registers and pc diverge and nothing else does", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_172a(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.deepEqual(
    moved,
    ["a", "f", "sp"],
    "the excluded set changed shape: only the accumulator, the flag byte and the stack " +
      "pointer may differ",
  );
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.equal(firstStateDiff(a.dumpState(), b.dumpState()), null, "RAM must still agree");
  console.log(`  EXCLUDED: ${moved.join(", ")} and pc — RAM unaffected`);
});

test("EXHAUSTIVE: every prior of both cells lands the same way", { skip }, () => {
  let swept = 0;
  for (let v = 0; v < 256; v++) {
    assert.equal(sweepDiff(loc_172a, v, v), null, `prior=${v},${v}`);
    assert.equal(sweepDiff(loc_172a, v, 255 - v), null, `prior=${v},${255 - v}`);
    swept += 2;
  }
  assert.equal(swept, 512, "must have swept every prior, in step and crossed");
  console.log(`  EXHAUSTIVE: ${swept} prior pairs identical`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT by the sweep`, { skip }, () => {
    let caught = 0;
    for (let v = 0; v < 256; v++) if (sweepDiff(twin, v, v)) caught++;
    assert.ok(caught > 0, `the sweep PASSED the ${label} twin — it has no teeth`);
    console.log(`  TEETH/${label}: caught on ${caught} priors`);
  });
}

test("BLIND SPOT: the real entry alone cannot tell setting from stepping", { skip }, () => {
  assert.equal(
    entryState().mem8[SEQUENCE_PHASE],
    LAST_PHASE - 1,
    "the captured entry's phase is no longer one below the constant this routine stores, " +
      "so the strict gate may now separate setting from stepping; re-derive this arm",
  );
  assert.equal(
    strict(brokenSteps).ram,
    null,
    "the strict gate now CATCHES the steps-instead twin — good news, but this test " +
      "documents the opposite and must be rewritten",
  );
  assert.ok(sweepDiff(brokenSteps, 0, 0), "the sweep must catch what the real entry cannot");
  console.log(
    `  BLIND SPOT: entry phase is ${LAST_PHASE - 1}, so stepping lands on ${LAST_PHASE} too; ` +
      "only the prior sweep separates the two",
  );
});

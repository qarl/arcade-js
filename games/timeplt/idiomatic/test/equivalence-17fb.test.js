// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_17fb — memory-equivalent to the frozen oracle at ROM 0x17FB.
 *
 * GATE: strict unit-capture through unitEquivalence on a REAL dispatch, plus an exhaustive sweep
 *   of the one cell the routine touches. Three bytes, `jp 0x0F1A`, and 0x0F1A is already
 *   decompiled as advanceSequenceSubStep — so the transfer is dissolved into a direct call here,
 *   which is this caller's own unit of work, and the gate is what proves the dissolve faithful.
 *
 * THE TAPE IS UNDRIVEN ATTRACT, NOT THE SHARED COIN -> START TAPE, and that is a measurement, not
 *   a preference. 0x17FB has NO transfer site anywhere in the image: it is entry eleven of the
 *   inline word table that follows the `rst 0x30` at 0x1658, dispatched on SEQUENCE_SUBSTEP, so
 *   grepping for `call`/`jp 0x17fb` finds nothing and only the table reaches it. Attract steps
 *   that sequence and dispatches it at frame 789; the shared coin -> start tape starts a game
 *   instead and does not reach it until frame 3074, past the shared budget. Undriven attract is
 *   therefore the tape that produces a real entry inside the budget.
 *
 * What it exercises, holes stated:
 *   1. EQUAL at the real dispatch — RAM byte-identical across the whole state dump.
 *   2. REGISTERS AND PC ARE EXCLUDED, DELIBERATELY. Memory-equivalence drops the register trace:
 *      the frozen original loads the cell's address, its increment sets the flag byte and its
 *      `ret` pops the stack pointer, none of which the rewrite does. `equal` is therefore false
 *      for a CORRECT routine. The divergence is pinned to exactly {f, h, l, sp} plus pc so
 *      "excluded" cannot quietly widen.
 *   3. EXHAUSTIVE over priors — the stepped cell swept 0..255 on the real entry, which is the only
 *      way the 255 -> 0 wrap is covered; the captured entry holds one low value.
 *   4. TEETH — a no-op twin, a steps-by-two twin and a wrong-cell twin, each caught by both the
 *      capture arm and every prior in the sweep.
 *
 * HOLE: one dispatch state, and it is enough for this routine and no more — it reads only the cell
 * it writes, so the sweep covers its whole input space; everything else in the machine is fixed at
 * the captured entry. Nothing here establishes WHICH sequence the index steps.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-17fb.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_17fb } from "../loc_17fb.js";
import { loc_17fb as oracle } from "../../translated/loc_17fb.js";
import { SEQUENCE_SUBSTEP } from "../names.js";
import { firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x17fb;

const SKIP = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

const attract = (overrides) => makeMachine(overrides, { tape: [] });

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    attract,
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
  if (entry === null) gate(loc_17fb);
  return entry;
}

/** Oracle against a candidate from the real entry, with the stepped cell forced to `prior`. */
function sweepDiff(candidate, prior) {
  const a = entryState().clone();
  const b = entryState().clone();
  a.mem8[SEQUENCE_SUBSTEP] = prior;
  b.mem8[SEQUENCE_SUBSTEP] = prior;
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
}

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: loc_17fb == oracle on RAM", { skip: SKIP }, () => {
  const r = gate(loc_17fb);
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  console.log(
    `  EQUAL: entry ${hex4(SEQUENCE_SUBSTEP)}=${entryState().mem8[SEQUENCE_SUBSTEP]}; RAM identical`,
  );
});

test("THE SHARED TAPE DOES NOT REACH IT, and that is why attract is used", { skip: SKIP }, () => {
  let hits = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => { hits += 1; return oracle(mm); }]]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(hits, 0, "if the shared coin -> start tape now reaches it, this gate should use it");
  console.log(`  TAPE: the shared coin -> start tape dispatches it ${hits} times in the budget`);
});

test("EXCLUDED, deliberately: registers and pc diverge and nothing else does", { skip: SKIP }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_17fb(b);

  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.deepEqual(
    moved,
    ["f", "h", "l", "sp"],
    "the excluded set changed shape: only the flag byte, the address register pair and the " +
      "stack pointer may differ",
  );
  assert.notEqual(a.pc, b.pc, "the frozen original's return moves pc; the rewrite returns to JS");
  assert.equal(a.mem8[SEQUENCE_SUBSTEP], b.mem8[SEQUENCE_SUBSTEP], "the one live-out");
  console.log(`  EXCLUDED: registers ${moved.join(", ")} and pc — RAM unaffected`);
});

test("EXHAUSTIVE over priors: every value 0..255 steps as the original steps it", { skip: SKIP }, () => {
  let swept = 0;
  for (let prior = 0; prior < 256; prior++) {
    const d = sweepDiff(loc_17fb, prior);
    assert.equal(d, null, `prior=${prior}: ${show(d)}`);
    swept++;
  }
  assert.equal(swept, 256, "must have swept every prior");

  const wrapped = entryState().clone();
  wrapped.mem8[SEQUENCE_SUBSTEP] = 255;
  loc_17fb(wrapped);
  assert.equal(wrapped.mem8[SEQUENCE_SUBSTEP], 0, "255 must round to 0, not widen to 256");
  console.log(`  EXHAUSTIVE: ${swept} priors identical, including the 255 -> 0 wrap`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────────

/** BUG: swallows the step. */
function brokenNoOp() {}

/** BUG: steps by two. */
function brokenStepsTwice(m) {
  m.mem8[SEQUENCE_SUBSTEP] = m.mem8[SEQUENCE_SUBSTEP] + 2;
}

/** BUG: steps the cell below the target, leaving the target untouched. */
function brokenWrongCell(m) {
  const addr = (SEQUENCE_SUBSTEP - 1) & 0xffff;
  m.mem8[addr] = m.mem8[addr] + 1;
}

for (const [label, twin] of [
  ["no-op", brokenNoOp],
  ["steps-by-two", brokenStepsTwice],
  ["wrong-cell", brokenWrongCell],
]) {
  test(`TEETH: the ${label} twin is CAUGHT at the real dispatch`, { skip: SKIP }, () => {
    const r = gate(twin);
    assert.notEqual(r.ram, null, `the gate PASSED the ${label} twin — it has no teeth`);
    console.log(`  TEETH/${label}: caught — ${show(r.ram)}`);
  });

  test(`TEETH: the ${label} twin is CAUGHT on every prior`, { skip: SKIP }, () => {
    let caught = 0;
    for (let prior = 0; prior < 256; prior++) if (sweepDiff(twin, prior)) caught++;
    assert.equal(caught, 256, `the sweep missed the ${label} twin on ${256 - caught} prior(s)`);
    console.log(`  TEETH/${label}: caught on all ${caught} priors`);
  });
}

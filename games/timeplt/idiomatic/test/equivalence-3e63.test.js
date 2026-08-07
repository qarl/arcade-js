// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_3e63 — memory-equivalent to the frozen oracle at ROM 0x3E63.
 *
 * GATE: crafted-entry, because the strict one is VACUOUS here and this file proves it.
 *   The coin -> start tape reaches 0x3E63 in quantity (the routine is walked over four
 *   object records every frame once the round engine is up), but the FIRST dispatch —
 *   the one unitEquivalence clones — has the record's head byte at zero, which is the
 *   arm that does nothing at all. A no-op twin passes the strict gate there. So the real
 *   comparison is an EXHAUSTIVE sweep of that head byte across 0..255 on the same
 *   captured machine, which is the routine's whole input space: it reads that one byte
 *   and nothing else.
 *
 *   1. DISPATCHED — the tape reaches the routine, and the entry is a real record base.
 *   2. BLIND      — the strict capture is asserted vacuous, with the no-op proving it.
 *   3. EXHAUSTIVE — heads 0..255, each arm run for real on both sides.
 *   4. ARMS       — the sweep is shown to have covered all three exits, not just one.
 *   5. EXCLUDED   — registers and pc diverge by design; the moved set is pinned.
 *   6. TEETH      — three broken twins, each caught by the same sweep.
 *
 * The two non-zero arms run continuations that are still the frozen oracle on both
 * sides, so what this file gates is the SPLIT — which of the three exits each head byte
 * takes — and not the continuations themselves.
 *
 * HOLE: one captured machine. Only the head byte is varied; the rest of RAM, and which
 * record the index register points at, are whatever the captured frame left.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3e63.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_3e63 } from "../loc_3e63.js";
import { loc_3e63 as oracle } from "../../translated/loc_3e63.js";
import { firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x3e63;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

/** The four record bases the caller walks, sixteen bytes apart. */
const RECORD_BASES = [0xa810, 0xa820, 0xa830, 0xa840];
const ALL_ONES = 255;

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
  if (entry === null) strict(loc_3e63);
  return entry;
}

/** Oracle vs candidate from the captured entry with the head byte forced to `head`. */
function headDiff(candidate, head) {
  const a = entryState().clone();
  const b = entryState().clone();
  a.mem8[a.regs.ix] = head;
  b.mem8[b.regs.ix] = head;
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
}

/** Does the oracle write anything at all for this head byte? */
function oracleWrites(head) {
  const before = entryState().clone();
  const after = entryState().clone();
  before.mem8[before.regs.ix] = head;
  after.mem8[after.regs.ix] = head;
  oracle(after);
  return firstStateDiff(before.dumpState(), after.dumpState()) !== null;
}

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

// ── broken twins ────────────────────────────────────────────────────────────────────────
// Each is a plausible way to get the three-way split wrong, and each must be CAUGHT by
// the same sweep the real arm passes.

/** BUG: does nothing, whatever the head byte says. */
function brokenNoOp() {}

/** BUG: the two non-zero arms are the wrong way round. */
function brokenSwappedArms(m) {
  const head = m.mem8[m.regs.ix];
  if (head === 0) return;
  m.call(head === ALL_ONES ? 0x3e8e : 0x3e6c);
}

/** BUG: treats every non-zero head as the all-ones arm, so the counting arm never runs. */
function brokenAlwaysAllOnes(m) {
  const head = m.mem8[m.regs.ix];
  if (head === 0) return;
  m.call(0x3e6c);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["swapped-arms", brokenSwappedArms],
  ["always-all-ones", brokenAlwaysAllOnes],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("DISPATCHED: the tape reaches the routine inside the harness budget", { skip }, () => {
  const e = entryState();
  assert.notEqual(e, null, `vacuous: 0x3e63 never entered within ${ENTRY_FRAMES} frames`);
  assert.ok(
    RECORD_BASES.includes(e.regs.ix),
    `entry base ${hex4(e.regs.ix)} is not one of the four records the caller walks`,
  );
  console.log(`  DISPATCHED: record ${hex4(e.regs.ix)}, head byte ${e.mem8[e.regs.ix]}`);
});

test("BLIND: the strict capture is VACUOUS here — a no-op passes it", { skip }, () => {
  const real = strict(loc_3e63);
  assert.equal(real.ram, null, `RAM diverged on the real arm — ${show(real.ram)}`);
  assert.equal(
    entryState().mem8[entryState().regs.ix],
    0,
    "the captured entry's head byte is no longer zero, so the strict gate may now have " +
      "teeth; re-derive this file rather than trusting the crafted sweep alone",
  );
  assert.equal(
    strict(brokenNoOp).ram,
    null,
    "the no-op is now CAUGHT by the strict gate — good news, but this test documents the " +
      "opposite and must be rewritten",
  );
  console.log("  BLIND: head byte zero at the captured entry; no-op passes the strict gate");
});

test("EXHAUSTIVE: every head byte 0..255 splits the same way", { skip }, () => {
  let swept = 0;
  for (let head = 0; head < 256; head++) {
    const d = headDiff(loc_3e63, head);
    assert.equal(d, null, `head=${head}: ${show(d)}`);
    swept++;
  }
  assert.equal(swept, 256, "must have swept every head byte");
  console.log(`  EXHAUSTIVE: ${swept} head bytes identical`);
});

test("ARMS: the sweep really covers all three exits, not just the inert one", { skip }, () => {
  assert.equal(oracleWrites(0), false, "head zero must be the arm that writes nothing");
  assert.equal(oracleWrites(ALL_ONES), true, "the all-ones arm must write something");
  const counting = [1, 2, 60, 128, 254].filter((h) => oracleWrites(h));
  assert.ok(counting.length > 0, "no other head byte reached an arm that writes anything");
  console.log(`  ARMS: inert at 0, live at ${ALL_ONES}, live at heads ${counting.join(", ")}`);
});

test("EXCLUDED, deliberately: registers and pc diverge and nothing else does", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_3e63(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.deepEqual(
    moved,
    ["a", "f", "sp"],
    "the excluded set changed shape: only the accumulator, the flag byte and the stack " +
      "pointer may differ on the inert arm",
  );
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.equal(firstStateDiff(a.dumpState(), b.dumpState()), null, "RAM must still agree");
  console.log(`  EXCLUDED: ${moved.join(", ")} and pc — RAM unaffected`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT by the sweep`, { skip }, () => {
    const caught = [];
    for (let head = 0; head < 256; head++) if (headDiff(twin, head)) caught.push(head);
    assert.ok(caught.length > 0, `the sweep PASSED the ${label} twin — it has no teeth`);
    assert.ok(
      !caught.includes(0),
      "the inert arm must not be where a twin is caught; that would mean the head-zero " +
        "exit writes memory and this file's account of it is wrong",
    );
    console.log(`  TEETH/${label}: caught on ${caught.length} head bytes, first ${caught[0]}`);
  });
}

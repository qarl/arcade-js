// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_3e36 — memory-equivalent to the frozen oracle at ROM 0x3E36.
 *
 * GATE: strict unit-capture with ONE exclusion, a corpus replay of every dispatch of a driven
 *   session, and an EXHAUSTIVE sweep of the byte that decides what each of the four slots does.
 *   What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — everything outside a two-byte dead scratch window below the
 *      entry stack pointer. Every arm PINS the window, so it cannot quietly widen.
 *   2. THE PARK IS MEASURED, NOT ASSERTED BY TASTE. The rewrite parks one value on the stack for
 *      each slot that is not idle, because the step those slots hand over to leaves through a
 *      frozen tail that lifts one off. An arm below runs a twin with the park REMOVED and reports
 *      the stack-pointer error and the fact that the divergence then escapes ABOVE the entry
 *      stack pointer — into the caller's live stack — which is what makes the park load-bearing
 *      rather than decorative. When that tail stops lifting, this arm fails and the park goes.
 *   3. THE FOUR SLOTS ARE THE CONTENT — asserted by twins that visit three of them, one of them
 *      twice, or the right records paired with the wrong entries, since nothing else about this
 *      entry is a decision.
 *   4. EXHAUSTIVE — the head byte of all four records swept 0..255 TOGETHER, which covers all
 *      three exits of the step and both sides of the park's condition, and then every MIXED
 *      pattern over a four-value alphabet, which is what discriminates the pairing of records to
 *      entries: with all four slots alike, every entry is written either way.
 *   5. CORPUS — every dispatch of a driven session, on a clone taken at the dispatch, with the
 *      head bytes the session actually presented reported rather than assumed.
 *   6. TEETH — six twins, each caught on its own exact count over the sweep.
 *
 * HOLE: the ORDER the four slots are visited in is not observable to this gate and no twin
 * attacks it. The four act on disjoint records and disjoint entries, so any order leaves the same
 * memory; a reordering twin would be caught zero times and would read as coverage it is not.
 *
 * HOLE: the sweep drives all four records to the SAME head byte. A per-slot mixture is covered
 * only by whatever the corpus happened to present, which the corpus arm reports.
 * HOLE: what the four slots hold is not settled here.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3e36.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_3e36 } from "../loc_3e36.js";
import { loc_3e36 as oracle } from "../../translated/loc_3e36.js";
import { loc_3e63 } from "../loc_3e63.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x3e36;

/** Record base, entry base, and the value the rewrite parks for a slot that is not idle. */
const SLOTS = [
  [0xa810, 0xaa12, 0x3e41],
  [0xa820, 0xaa14, 0x3e4c],
  [0xa830, 0xaa16, 0x3e57],
  [0xa840, 0xaa18, 0x3e62],
];
const IDLE = 0;

/**
 * The dead stack scratch: one parked value, at the bottom of the frozen chain's own bracket.
 * Measured as an upper bound over the whole sweep, and pinned by every arm.
 */
const SCRATCH_BYTES = 2;

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
  const heads = new Set();
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    for (const [record] of SLOTS) heads.add(mm.mem8[record]);
    if (captured === null) captured = mm.clone();
    if (compare(candidate, mm)) caught++;
    return oracle(mm);
  }]]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  return { dispatches, caught, heads };
}

function entryState() {
  if (captured === null) replay(loc_3e36);
  return captured;
}

/** A real captured machine with every one of the four record head bytes forced to one value. */
function craft(head) {
  const m = entryState().clone();
  for (const [record] of SLOTS) m.mem8[record] = head;
  return m;
}

/**
 * The same, but each slot given its OWN head byte out of a four-value alphabet — the inert one,
 * the two the step splits on, and one that reaches the clamp. A uniform sweep cannot see which
 * entry base a record was paired with, because every slot ends up written either way.
 */
const ALPHABET = [0, 1, 255, 60];

function craftMixed(pattern) {
  const m = entryState().clone();
  SLOTS.forEach(([record], i) => {
    m.mem8[record] = ALPHABET[(pattern >> (2 * i)) & 3];
  });
  return m;
}

const MIXED = ALPHABET.length ** SLOTS.length;

function judgingStates() {
  const out = [];
  for (let head = 0; head < 256; head++) out.push(craft(head));
  for (let pattern = 0; pattern < MIXED; pattern++) out.push(craftMixed(pattern));
  return out;
}

const JUDGED = 256 + MIXED;

function sweepCaught(candidate) {
  let caught = 0;
  for (const machine of judgingStates()) if (compare(candidate, machine)) caught++;
  return caught;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  const entry = entryState();
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  loc_3e36(b);
  assert.deepEqual(
    outsideScratch(a, b, sp),
    [],
    `a divergence escaped the scratch window — ${show(outsideScratch(a, b, sp)[0])}`,
  );
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    ["a", "f", "sp"],
    "the excluded set changed shape: the two cursors are left where the fourth slot put them " +
      "on both sides, so neither of them may appear here",
  );
  assert.equal(a.regs.ix, b.regs.ix, "the record cursor diverged");
  assert.equal(a.regs.iy, b.regs.iy, "the entry cursor diverged");
  console.log(`  EQUAL: sp ${hex4(sp)}, cursors ${hex4(a.regs.ix)}/${hex4(a.regs.iy)}`);
});

test("THE PARK IS LOAD-BEARING: removing it drifts the stack into the caller's own", { skip }, () => {
  const unparked = (m) => {
    for (const [record, entry] of SLOTS) {
      m.regs.ix = record;
      m.regs.iy = entry;
      loc_3e63(m);
    }
  };

  let worstStackError = 0;
  let escapedAbove = 0;
  let anyDiff = 0;
  for (let head = 0; head < 256; head++) {
    const machine = craft(head);
    const sp = machine.regs.sp;
    const a = machine.clone();
    const b = machine.clone();
    oracle(a);
    unparked(b);
    worstStackError = Math.max(worstStackError, Math.abs(a.regs.sp - b.regs.sp));
    const strays = outsideScratch(a, b, sp);
    if (strays.length > 0) anyDiff++;
    if (strays.some((d) => d.addr >= sp)) escapedAbove++;
  }
  assert.ok(
    worstStackError > 0,
    "removing the park no longer moves the stack pointer at all, so the tail this entry parks " +
      "for has stopped lifting and the park should be removed from the rewrite",
  );
  assert.ok(
    escapedAbove > 0,
    "removing the park no longer disturbs anything at or above the entry stack pointer, so it " +
      "is no longer load-bearing and this arm is the one that should be deleted",
  );
  assert.equal(sweepCaught(loc_3e36), 0, "the parked rewrite must pass every judged state");
  console.log(
    `  PARK: without it the stack pointer is out by up to ${worstStackError} bytes, ` +
      `${anyDiff} of 256 head bytes diverge and ${escapedAbove} escape into live stack`,
  );
});

test("EXHAUSTIVE: every uniform head byte and every mixed pattern behaves alike", { skip }, () => {
  for (let head = 0; head < 256; head++) {
    const d = compare(loc_3e36, craft(head));
    assert.equal(d, null, `head=${head}: ${show(d)}`);
  }
  for (let pattern = 0; pattern < MIXED; pattern++) {
    const d = compare(loc_3e36, craftMixed(pattern));
    assert.equal(d, null, `pattern=${pattern}: ${show(d)}`);
  }
  console.log(`  EXHAUSTIVE: 256 uniform head bytes and ${MIXED} mixed patterns identical`);
});

test("THE SWEEP REACHES BOTH SIDES OF THE PARK, and the idle arm is inert", { skip }, () => {
  const idle = craft(IDLE);
  const before = idle.clone();
  oracle(idle);
  assert.deepEqual(
    outsideScratch(before, idle, before.regs.sp),
    [],
    "the all-idle sweep entry now moves memory, so the park's condition covers the wrong set",
  );
  let live = 0;
  for (let head = 1; head < 256; head++) {
    const m = craft(head);
    const was = m.clone();
    oracle(m);
    if (outsideScratch(was, m, was.regs.sp).length > 0) live++;
  }
  assert.ok(live > 0, "no non-idle head byte moved anything, so the live side is untested");
  console.log(`  BOTH SIDES: the idle head is inert; ${live} of 255 non-idle heads move memory`);
});

test("CORPUS: every dispatch of a driven session replays identically", { skip }, () => {
  const r = replay(loc_3e36);
  assert.equal(r.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(r.caught, 0, `the rewrite diverged on ${r.caught} real dispatches`);
  console.log(
    `  CORPUS: ${r.dispatches} dispatches identical; head bytes presented ${[...r.heads].join(",")}`,
  );
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────
// Each twin visits a different set of slots, since choosing the four slots is the whole of
// what this entry decides. All of them park exactly as the real one does, so a catch measures
// the slot set and not the park.

function visit(m, slots) {
  for (const [record, entry, parked] of slots) {
    m.regs.ix = record;
    m.regs.iy = entry;
    if (m.mem8[record] !== IDLE) m.push16(parked);
    loc_3e63(m);
  }
}

/** The same four records paired with the entry bases rotated by one. */
const CROSSED = SLOTS.map(([record, , parked], i) => [record, SLOTS[(i + 1) % 4][1], parked]);
const ONE_RECORD_ON = SLOTS.map(([record, entry, parked]) => [record + 16, entry, parked]);
const ONE_ENTRY_ON = SLOTS.map(([record, entry, parked]) => [record, entry + 2, parked]);

const TWINS = [
  ["no-op", () => {}, 510],
  ["three-slots", (m) => visit(m, SLOTS.slice(0, 3)), 447],
  ["first-slot-twice", (m) => visit(m, [SLOTS[0], ...SLOTS]), 65],
  ["crossed-pairs", (m) => visit(m, CROSSED), 238],
  ["wrong-record-stride", (m) => visit(m, ONE_RECORD_ON), 510],
  ["wrong-entry-stride", (m) => visit(m, ONE_ENTRY_ON), 508],
];

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of the judged states`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${JUDGED} judged states`);
  });
}

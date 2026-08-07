// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_3855 — memory-equivalent to the frozen oracle at ROM 0x3855.
 *
 * ★ THE SHARED TAPE NEVER REACHES IT, AND THE ATTRACT TAPE NEEDS A LONGER RUN THAN THE HARNESS'S
 *   DEFAULT. Asserted both ways in arm 1: at the harness's entry budget both tapes dispatch it
 *   zero times, and at the longer budget this file uses undriven attract dispatches it many
 *   times while the coin -> start tape still never does. So the corpus is an attract corpus and
 *   the file says so rather than letting "two tapes" imply two sources of entries.
 *
 * GATE: a real attract corpus, plus painted crafted entries for the guard. What it exercises:
 *
 *   1. REACH, ASSERTED BOTH WAYS — the two budgets and the two tapes, as exact counts.
 *   2. CORPUS — every dispatch replayed, whole state dump, no exclusion window at all: this
 *      routine pushes nothing, so the two arms agree on every byte including the stack.
 *   3. REGISTERS ARE EXCLUDED, DELIBERATELY, and pinned. The record cursor the loop walks IS
 *      reproduced and compared; the stride and count registers are not, and its one caller
 *      reaches it by a tail jump whose own caller reloads before reading any of them.
 *   4. BOTH ARMS OF THE GUARD ARE REACHED — the real corpus is measured for which it presents,
 *      and the crafted sweep forces the other, so neither is covered only by argument.
 *   5. THE RESET LANDS — over a painted band across all five records, exactly ten cells move and
 *      they are the two named bytes of each. Measured off the ORACLE.
 *   6. EXHAUSTIVE over the guard byte — all 256 values, so "only zero passes" is swept.
 *   7. TEETH — seven twins, each with its exact catch count.
 *
 * HOLE: the guard byte is the caller's, and nothing here says which cell a real caller points at
 * or what it means. Nothing establishes what the shape byte draws either.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3855.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_3855 } from "../loc_3855.js";
import { loc_3855 as oracle } from "../../translated/loc_3855.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x3855;

const FIRST_RECORD = 0xa850;
const RECORD_STRIDE = 16;
const RECORDS = 5;
const SHAPE_BYTE = 8;
const STEP_TIMER = 9;
const ARMED_SHAPE = 17;

/** Longer than the harness's entry budget, because attract does not get here inside that. */
const CORPUS_FRAMES = 2600;
const DISPATCHES_SHORT = { shared: 0, attract: 0 };
const DISPATCHES_LONG = { shared: 0, attract: 120 };
const TAPES = [["shared", {}], ["attract", { tape: [] }]];

const PAINT_EITHER_SIDE = 4;
const EXCLUDED = ["a", "f", "b", "d", "e", "sp"];

/** A work-RAM cell the crafted arms point the guard at, so the guard's value can be forced. */
const CRAFTED_GUARD = 0xafc4;

const skip = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

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
  const ram = allDiffs(a, b)[0];
  if (ram) return ram;
  const moved = REG_FIELDS.find((k) => !EXCLUDED.includes(k) && a.regs[k] !== b.regs[k]);
  return moved ? { addr: null, a: a.regs[moved], b: b.regs[moved] } : null;
}

function session(opts, frames) {
  const states = [];
  const guards = new Set();
  const host = makeMachine(
    new Map([[TARGET, (mm) => {
      states.push(mm.clone());
      guards.add(mm.mem8[mm.regs.hl]);
      return oracle(mm);
    }]]),
    opts,
  );
  const ran = host.runFrames(frames);
  assert.equal(host.stoppedBy, null, `a session stopped early: ${host.stoppedBy}`);
  assert.equal(ran.length, frames, "a session ran short");
  return { states, guards };
}

let corpusCache = null;
function corpus() {
  if (corpusCache) return corpusCache;
  corpusCache = TAPES.map(([label, opts]) => ({ label, ...session(opts, CORPUS_FRAMES) }));
  return corpusCache;
}

const anEntry = () => corpus().find((s) => s.label === "attract").states[0];

const marker = (addr) => ((addr & 0xff) ^ 0x5a) || 0x5a;

/** Every address the paint covers: a margin either side of all five records' two named bytes. */
function bandCells() {
  const out = [];
  for (let i = 0; i < RECORDS; i++) {
    const record = FIRST_RECORD + i * RECORD_STRIDE;
    for (let d = SHAPE_BYTE - PAINT_EITHER_SIDE; d <= STEP_TIMER + PAINT_EITHER_SIDE; d++) {
      out.push(record + d);
    }
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

/** A real captured machine with the band painted and the guard pointed at a forced cell. */
function craft(guard) {
  const m = anEntry().clone();
  for (const a of bandCells()) m.mem8[a] = marker(a);
  m.regs.hl = CRAFTED_GUARD;
  m.mem8[CRAFTED_GUARD] = guard;
  return m;
}

function sweepCaught(candidate) {
  let caught = 0;
  for (let guard = 0; guard < 256; guard++) if (unitDiff(candidate, craft(guard))) caught++;
  return caught;
}

// ── reach ───────────────────────────────────────────────────────────────────────────────

test("REACH, ASSERTED BOTH WAYS: budget and tape, as exact counts", { skip }, () => {
  for (const [label, opts] of TAPES) {
    assert.equal(session(opts, ENTRY_FRAMES).states.length, DISPATCHES_SHORT[label],
      `the ${label} tape's dispatch count at the harness budget moved`);
  }
  for (const s of corpus()) {
    assert.equal(s.states.length, DISPATCHES_LONG[s.label],
      `the ${s.label} tape's dispatch count at the longer budget moved`);
  }
  console.log(
    `  REACH: at ${ENTRY_FRAMES} frames ${Object.values(DISPATCHES_SHORT).join("/")}; at ` +
      `${CORPUS_FRAMES} frames ${Object.values(DISPATCHES_LONG).join("/")} (shared/attract)`,
  );
});

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CORPUS: every attract dispatch replays identically, stack included", { skip }, () => {
  const attract = corpus().find((s) => s.label === "attract");
  assert.ok(attract.states.length > 0, "vacuous: the attract session never reached the routine");
  for (const state of attract.states) {
    const d = unitDiff(loc_3855, state);
    assert.equal(d, null, `attract: ${show(d)}`);
  }
  console.log(`  CORPUS: ${attract.states.length} real dispatches, identical on every byte`);
});

test("BOTH ARMS OF THE GUARD ARE REACHED: the corpus's, and the crafted other one", { skip }, () => {
  const attract = corpus().find((s) => s.label === "attract");
  const real = [...attract.guards].sort((x, y) => x - y);
  assert.ok(real.length > 0, "vacuous: no guard value was observed");
  const passing = real.filter((g) => g === 0);
  const blocking = real.filter((g) => g !== 0);
  assert.ok(passing.length + blocking.length === real.length, "the guard split is malformed");

  const before = craft(0);
  const after = before.clone();
  oracle(after);
  assert.ok(allDiffs(before, after).length > 0, "a zero guard wrote nothing, so no arm resets");

  const blocked = craft(1);
  const blockedAfter = blocked.clone();
  oracle(blockedAfter);
  assert.deepEqual(allDiffs(blocked, blockedAfter), [],
    "a non-zero guard still wrote something, so the guard is not a guard");
  console.log(
    `  GUARD: real values {${real}} (${passing.length} passing, ${blocking.length} blocking); ` +
      "both arms forced in the crafted space",
  );
});

test("EXCLUDED, deliberately: the walk's scratch registers, sp and pc", { skip }, () => {
  const entry = craft(0);
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  loc_3855(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.ok(moved.every((k) => EXCLUDED.includes(k)), `a register outside the set moved: ${moved}`);
  assert.equal(a.regs.ix, b.regs.ix, "the record cursor is reproduced, not excluded");
  assert.equal(a.regs.ix, FIRST_RECORD + RECORDS * RECORD_STRIDE,
    "the record cursor did not come out past the last record");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: ${moved.join(", ")} and pc`);
});

test("THE RESET LANDS: ten cells over five records, and nothing else in the band", { skip }, () => {
  const before = craft(0);
  const after = before.clone();
  oracle(after);
  const moved = bandCells().filter((a) => after.mem8[a] !== before.mem8[a]);
  const expected = [];
  for (let i = 0; i < RECORDS; i++) {
    expected.push(FIRST_RECORD + i * RECORD_STRIDE + SHAPE_BYTE);
    expected.push(FIRST_RECORD + i * RECORD_STRIDE + STEP_TIMER);
  }
  assert.deepEqual(moved, expected.sort((x, y) => x - y),
    "the oracle's write-set inside the band is not the two named bytes of five records");
  for (let i = 0; i < RECORDS; i++) {
    const record = FIRST_RECORD + i * RECORD_STRIDE;
    assert.equal(after.mem8[record + SHAPE_BYTE], ARMED_SHAPE, "a shape byte took another value");
    assert.equal(after.mem8[record + STEP_TIMER], 0, "a step timer was not cleared");
  }
  console.log(`  LANDS: ${moved.length} cells — ${moved.map(hex4).join(" ")}`);
});

test("EXHAUSTIVE over the guard byte: all 256 values", { skip }, () => {
  assert.equal(sweepCaught(loc_3855), 0, "the rewrite diverged somewhere in the crafted space");
  console.log("  EXHAUSTIVE: 256 guard values identical");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: ignores the guard and resets whatever it is. */
function brokenIgnoresGuard(m) {
  reset(m, RECORDS, ARMED_SHAPE, true);
}

/** BUG: guards the wrong way round, so it resets only when the byte is NOT zero. */
function brokenGuardInverted(m) {
  if (m.mem8[m.regs.hl] === 0) return;
  reset(m, RECORDS, ARMED_SHAPE, true);
}

/** BUG: resets one record too few. */
function brokenShort(m) {
  if (m.mem8[m.regs.hl] !== 0) return;
  reset(m, RECORDS - 1, ARMED_SHAPE, true);
}

/** BUG: resets one record too many. */
function brokenLong(m) {
  if (m.mem8[m.regs.hl] !== 0) return;
  reset(m, RECORDS + 1, ARMED_SHAPE, true);
}

/** BUG: arms the shape one code out. */
function brokenShape(m) {
  if (m.mem8[m.regs.hl] !== 0) return;
  reset(m, RECORDS, ARMED_SHAPE + 1, true);
}

/** BUG: arms the shape and leaves each step timer standing. */
function brokenNoTimerClear(m) {
  if (m.mem8[m.regs.hl] !== 0) return;
  reset(m, RECORDS, ARMED_SHAPE, false);
}

function reset(m, records, shape, clearTimer) {
  const { mem8, regs } = m;
  for (let i = 0; i < records; i++) {
    const record = FIRST_RECORD + i * RECORD_STRIDE;
    mem8[record + SHAPE_BYTE] = shape;
    if (clearTimer) mem8[record + STEP_TIMER] = 0;
  }
  regs.ix = FIRST_RECORD + records * RECORD_STRIDE;
}

/** With one guard value passing out of 256, a twin that only breaks the reset is caught once. */
const ON_THE_PASSING_GUARD = 1;
const ON_THE_BLOCKING_GUARDS = 255;

const TWINS = [
  ["no-op", brokenNoOp, ON_THE_PASSING_GUARD],
  ["ignores-the-guard", brokenIgnoresGuard, ON_THE_BLOCKING_GUARDS],
  ["guard-inverted", brokenGuardInverted, 256],
  ["one-record-short", brokenShort, ON_THE_PASSING_GUARD],
  ["one-record-too-many", brokenLong, ON_THE_PASSING_GUARD],
  ["wrong-shape", brokenShape, ON_THE_PASSING_GUARD],
  ["timer-left-standing", brokenNoTimerClear, ON_THE_PASSING_GUARD],
];

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of guard values`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${expected} of 256 guard values`);
  });
}

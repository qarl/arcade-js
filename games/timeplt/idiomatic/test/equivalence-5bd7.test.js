// SPDX-License-Identifier: GPL-3.0-only
/**
 * blankKillMeterThenAdvancePenRunStep — memory-equivalent to the frozen oracle at ROM 0x5BD7.
 * GATE: unit-capture at every real dispatch of the coin-start tape (both branches present), plus
 *   crafted full-path entries seating the pen run on a zero-row prior. RAM compared with the dead
 *   stack scratch below the seated SP masked out (the oracle nests calls, the rewrite dissolves the
 *   pen-run's ret into itself), SP drift and the return value checked, and teeth on both branches.
 *   Registers are not compared: the dissolved pen run leaves dead scratch and no caller consumes one
 *   — this is a tail-jump sequence arm. Run:
 *   node --test games/timeplt/idiomatic/test/equivalence-5bd7.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { blankKillMeterThenAdvancePenRunStep as candidate } from "../blankKillMeterThenAdvancePenRunStep.js";
import { loc_5bd7 as oracle } from "../../translated/loc_5bd7.js";
import { blankFourteenCharCells } from "../blankFourteenCharCells.js";
import { drawInterpolatedPenRun } from "../drawInterpolatedPenRun.js";
import { advanceSequencePhase } from "../advanceSequencePhase.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";
import { u8 } from "../../../../core/int.js";

const TARGET = 0x5bd7;
const SEQ_CELL = 0xa9ac;
const GUARD_CELL = 0xa9ab;
const RUN_INDEX = 0xa9e2;
// Seating the run index here makes the pen run reseat to a zero row integer, so drawInterpolatedPenRun returns true
// and the full checksum path runs rather than the early return; measured from advancePenRunAnimationStep's sibling arm.
const ZERO_ROW_PRIOR = 0x69;

const XOR_BLOCK = 0x0bdd;
const XOR_LEN = 256;
const XOR_TARGET = 0x1c;
const SUM_BLOCK = 0x1734;
const SUM_LEN = 20;
const SUM_BIAS = 0x77;

// Every game-data write lands at or below here; the stack seats well above it, so masking the
// scratch window can never hide a data divergence. Asserted against the measured floor below.
const DATA_TOP = 0xadff;
const COINSTART_DISPATCHES = 106;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── the masked comparison ─────────────────────────────────────────────────────────────────

/**
 * Oracle vs a candidate on independent clones. The oracle pushes dead return addresses into the
 * stack scratch the rewrite never writes, so the diff excludes [lowestSp, seat) — lowestSp measured
 * by watching the oracle's own pushes. Anything outside that window has escaped.
 */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => {
    push(v);
    if (a.regs.sp < low) low = a.regs.sp;
  };
  const retOracle = oracle(a);
  let retCand;
  try {
    retCand = cand(b);
  } catch {
    return { escaped: { addr: null }, low, seat, spDiff: 0, retOracle, retCand };
  }
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  return { escaped, low, seat, spDiff: a.regs.sp - b.regs.sp, retOracle, retCand };
}

/** Cells the oracle moves from a state, ignoring the stack scratch — a branch's footprint. */
function footprint(machine) {
  const a = machine.clone();
  const before = a.dumpState().slice();
  oracle(a);
  const now = a.dumpState();
  const cells = [];
  for (let i = 0; i < now.length; i++) {
    const addr = a.stateOffsetToAddr(i);
    if (now[i] !== before[i] && addr <= DATA_TOP) cells.push(addr);
  }
  return cells;
}

/** Which branch a machine drives, read off the frozen side by whether it steps the sub-index. */
function branchOf(machine) {
  const a = machine.clone();
  const before = a.mem.read8(SEQ_CELL);
  oracle(a);
  return ((a.mem.read8(SEQ_CELL) - before) & 0xff) === 1 ? "full" : "early";
}

// ── the corpus, and the two branch scenarios ──────────────────────────────────────────────

let pool = null;
function corpus() {
  if (pool === null) {
    const captured = [];
    const m = makeMachine(new Map([[TARGET, (mm) => {
      captured.push(mm.clone());
      return oracle(mm);
    }]]));
    const frames = m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
    assert.equal(frames.length, ENTRY_FRAMES, "the capture run ran short");
    pool = captured;
  }
  return pool;
}

/** A pooled entry with the run index seated so the pen run reseats to a zero row integer. */
function craftFull(entry) {
  const m = entry.clone();
  m.mem.write8(RUN_INDEX, ZERO_ROW_PRIOR);
  return m;
}

/** Two early entries and three full ones (one real, two crafted), covering both branches. */
function scenarios() {
  const p = corpus();
  const early = p.filter((e) => branchOf(e) === "early");
  const full = p.find((e) => branchOf(e) === "full");
  return [
    ["early-0", early[0]],
    ["early-1", early[1]],
    ["full-real", full],
    ["full-craft-0", craftFull(early[0])],
    ["full-craft-1", craftFull(early[1])],
  ];
}

// ── the twins ─────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every parameter matches blankKillMeterThenAdvancePenRunStep by default. */
function build({ blank = true, branch = "nz", phase = "clean", bias = SUM_BIAS, store = true, step = true }) {
  return (m) => {
    const { mem8 } = m;
    if (blank) blankFourteenCharCells(m);
    const reseatedAtRowZero = drawInterpolatedPenRun(m);
    if (branch === "nz" ? !reseatedAtRowZero : reseatedAtRowZero) return;
    let fold = 0;
    for (let i = 0; i < XOR_LEN; i++) fold ^= mem8[XOR_BLOCK + i];
    if (phase === "clean" ? fold !== XOR_TARGET : fold === XOR_TARGET) advanceSequencePhase(m);
    let acc = mem8[GUARD_CELL];
    for (let i = 0; i < SUM_LEN; i++) acc = u8(acc + mem8[SUM_BLOCK + i]);
    if (store) mem8[GUARD_CELL] = u8(acc + bias);
    return step ? advanceSequenceSubStep(m) : undefined;
  };
}

const TWINS = [
  ["no-op", () => {}, 5],
  ["skip-blank", build({ blank: false }), 2],
  ["invert-branch", build({ branch: "z" }), 5],
  // spurious-phase raises the tamper phase on a clean image; skip-substep drops the tail; wrong-sum-bias
  // stores a value one off, proving the self-cancelling checksum is really computed and written.
  ["spurious-phase", build({ phase: "tamper" }), 3],
  ["skip-substep", build({ step: false }), 3],
  ["wrong-sum-bias", build({ bias: SUM_BIAS + 1 }), 3],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("DISPATCHED: both tapes reach this arm", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["undriven", { tape: [] }]]) {
    let seen = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => { seen++; return oracle(mm); }]]), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    assert.ok(seen > 0, `${label} never dispatched this arm, so the corpus below is empty`);
    console.log(`  DISPATCHED: ${label} — ${hex4(TARGET)} entered ${seen} times`);
  }
});

test("EQUAL over the corpus: RAM identical outside the masked stack scratch", { skip }, () => {
  const p = corpus();
  assert.equal(p.length, COINSTART_DISPATCHES, "the coin-start dispatch count moved");
  let full = 0;
  for (const e of p) {
    const r = compare(candidate, e);
    assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${hex4(r.escaped.addr)}`);
    assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached into game data`);
    if (branchOf(e) === "full") full++;
  }
  assert.ok(full > 0, "vacuous: the corpus never took the full checksum path");
  console.log(`  EQUAL: ${p.length} entries identical (${full} on the full path)`);
});

test("PATHS: both branches equivalent, and the full path steps the sub-index", { skip }, () => {
  const prints = {};
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, `${label} escaped at ${r.escaped && hex4(r.escaped.addr)}`);
    prints[label] = new Set(footprint(m));
  }
  const both = scenarios().map(([, m]) => branchOf(m));
  assert.ok(both.includes("early") && both.includes("full"), "the scenarios miss a branch");
  // ★ Vacuity: the full path must step the sub-index and the early path must not, or a rewrite that
  // ignored the branch would pass.
  assert.ok(prints["full-craft-0"].has(SEQ_CELL), "the full path did not step the sub-index");
  assert.ok(!prints["early-0"].has(SEQ_CELL), "the early path stepped the sub-index");
  console.log(`  PATHS: ${scenarios().length} scenarios equivalent; branches ${both.join(", ")}`);
});

// The rewrite performs no ROM `ret` of its own -- the pen run it opens with no longer pops one either --
// so called directly it leaves SP where it found it, and placed through the game's dispatch seam
// (withOmittedRet, which completes an omitted ret) it lands SP exactly where the oracle does.
test("SP and RETURN: SP-neutral when called directly, level with the oracle when placed, same return", { skip }, () => {
  const placed = withOmittedRet(candidate, TARGET);
  for (const [label, m] of scenarios()) {
    const raw = m.clone();
    candidate(raw);
    assert.equal(raw.regs.sp, m.regs.sp, `${label}: called directly the rewrite moved SP -- it popped a return slot`);
    const r = compare(placed, m);
    assert.equal(r.spDiff, 0, `${label}: placed through the seam, SP did not land where the oracle leaves it`);
    assert.equal(r.retOracle, r.retCand, `${label}: the return value diverged`);
  }
  console.log("  SP: unmoved when called directly; 0 drift against the oracle when placed; return values identical");
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of scenarios`, { skip }, () => {
    let caught = 0;
    for (const [, m] of scenarios()) if (compare(twin, m).escaped) caught++;
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${scenarios().length} scenarios`);
  });
}

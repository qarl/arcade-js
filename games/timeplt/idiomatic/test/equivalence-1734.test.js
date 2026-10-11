// SPDX-License-Identifier: GPL-3.0-only
/**
 * advancePenRunAnimationStep — memory-equivalent to the frozen oracle at ROM 0x1734.
 * GATE: neither shipped tape dispatches this address, so entries are sourced at 0x0201 (the pen-run
 *   sub-call it opens with, heavily dispatched) and the checksum branch is forced by seating the run
 *   index on the one prior that reseats the pen to a zero row. RAM is compared with the dead stack
 *   scratch below the seated SP masked out (the oracle nests calls, the rewrite dissolves them), the
 *   SP drift and the return value checked, and teeth on both branches. Registers are not compared:
 *   the dissolved pen-run does not reproduce the register dance and no caller consumes one — this is
 *   a tail-jump sequence arm. Run:
 *   node --test games/timeplt/idiomatic/test/equivalence-1734.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { advancePenRunAnimationStep as candidate } from "../advancePenRunAnimationStep.js";
import { loc_1734 as oracle } from "../../translated/loc_1734.js";
import { loc_0201 as oracle0201 } from "../../translated/loc_0201.js";
import { drawInterpolatedPenRun } from "../drawInterpolatedPenRun.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";

const TARGET = 0x1734;
const ENTRY_SITE = 0x0201;
const GUARDED_BLOCK = 0x1748;
const GUARDED_LEN = 0x22;
const GUARD_CELL = 0xa817;
const SEQ_CELL = 0xa9ac;
const RUN_INDEX = 0xa9e2;
// Seating the run index here makes the pen-run reseat to a zero row integer, so the oracle takes
// the checksum branch rather than the early ret; the sentinel makes the (0-on-clean) store visible.
const ZERO_ROW_PRIOR = 0x69;
const GUARD_SENTINEL = 0x77;

// Every game-data write lands at or below here; the stack seats well above it, so masking the
// scratch window can never hide a data divergence. Asserted against the measured floor below.
const DATA_TOP = 0xadff;
const POOL_CAP = 130;

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
  const retCand = cand(b);
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

// ── the entry pool, and the two branch scenarios ──────────────────────────────────────────

let pool = null;
function entryPool() {
  if (pool === null) {
    const captured = [];
    const m = makeMachine(new Map([[ENTRY_SITE, (mm) => {
      if (captured.length < POOL_CAP) captured.push(mm.clone());
      return oracle0201(mm);
    }]]));
    m.runFrames(ENTRY_FRAMES);
    pool = captured;
  }
  return pool;
}

/** A pooled entry with the run index seated on the zero-row prior and the guard cell made dirty. */
function craftChecksum(entry) {
  const m = entry.clone();
  m.mem.write8(RUN_INDEX, ZERO_ROW_PRIOR);
  m.mem.write8(GUARD_CELL, GUARD_SENTINEL);
  return m;
}

/** Two entries per branch: the pooled state takes the early ret, the crafted one the checksum. */
function scenarios() {
  const p = entryPool();
  return [
    ["retnz-0", p[0]],
    ["retnz-1", p[1]],
    ["checksum-0", craftChecksum(p[0])],
    ["checksum-2", craftChecksum(p[2])],
  ];
}

/** Which branch a machine drives, read off the frozen side by whether it steps the sequence cell. */
function branchOf(machine) {
  const a = machine.clone();
  const before = a.mem.read8(SEQ_CELL);
  oracle(a);
  return ((a.mem.read8(SEQ_CELL) - before) & 0xff) === 1 ? "checksum" : "retnz";
}

// ── the twins ─────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every parameter matches advancePenRunAnimationStep by default. */
function build({ branch = "nz", base = GUARDED_BLOCK, len = GUARDED_LEN, cell = GUARD_CELL, store = true, step = true }) {
  return (m) => {
    const { mem8 } = m;
    const reseatedAtRowZero = drawInterpolatedPenRun(m);
    if (branch === "nz" ? !reseatedAtRowZero : reseatedAtRowZero) return;
    let sum = 0;
    for (let i = 0; i < len; i++) sum = (sum - mem8[base + i]) & 0xff;
    if (store) mem8[cell] = sum;
    return step ? advanceSequenceSubStep(m) : undefined;
  };
}

const TWINS = [
  ["no-op", () => {}, 4],
  ["inverted-branch", build({ branch: "z" }), 4],
  ["skip-store", build({ store: false }), 2],
  ["wrong-cell", build({ cell: GUARD_CELL - 1 }), 2],
  ["wrong-length", build({ len: GUARDED_LEN - 1 }), 2],
  ["wrong-base", build({ base: GUARDED_BLOCK - 1 }), 2],
  ["skip-step", build({ step: false }), 2],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: no tape dispatches this address, with a live control at the entry site", { skip }, () => {
  const seen = { [TARGET]: 0, [ENTRY_SITE]: 0 };
  const m = makeMachine(new Map([
    [TARGET, (mm) => { seen[TARGET]++; return oracle(mm); }],
    [ENTRY_SITE, (mm) => { seen[ENTRY_SITE]++; return oracle0201(mm); }],
  ]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the run stopped early: ${m.stoppedBy}`);
  // The zero counts as evidence ONLY because the same tap counted the entry site in the same run.
  assert.ok(seen[ENTRY_SITE] > 0, "the entry-site tap never fired, so the zero beside it is blind");
  assert.equal(seen[TARGET], 0, "this address is dispatched now; capture plain entries instead");
  console.log(`  UNREACHED: ${hex4(TARGET)} entered 0 times; entry site ${seen[ENTRY_SITE]}`);
});

test("EQUAL over the pool: RAM identical outside the masked stack scratch", { skip }, () => {
  const p = entryPool();
  assert.ok(p.length > 0, "vacuous: the tape never reached the entry site");
  let checksumPaths = 0;
  for (const e of p) {
    const r = compare(candidate, e);
    assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${hex4(r.escaped.addr)}`);
    assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached into game data`);
    if (branchOf(e) === "checksum") checksumPaths++;
  }
  console.log(`  EQUAL: ${p.length} pooled entries identical (${checksumPaths} on the checksum branch)`);
});

test("PATHS: both branches equivalent, and the checksum branch really writes the guard", { skip }, () => {
  const prints = {};
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, `${label} escaped at ${r.escaped && hex4(r.escaped.addr)}`);
    prints[label] = new Set(footprint(m));
  }
  const both = scenarios().map(([, m]) => branchOf(m));
  assert.ok(both.includes("retnz") && both.includes("checksum"), "the scenarios miss a branch");
  // ★ Vacuity: the checksum branch must touch the guard and sequence cells and the ret branch neither,
  // or the pokes changed nothing and a rewrite that ignored the branch would pass.
  assert.ok(prints["checksum-0"].has(GUARD_CELL) && prints["checksum-0"].has(SEQ_CELL),
    "the checksum branch wrote neither the guard nor the sequence cell");
  assert.ok(!prints["retnz-0"].has(GUARD_CELL) && !prints["retnz-0"].has(SEQ_CELL),
    "the early-ret branch already wrote the guard or sequence cell");
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

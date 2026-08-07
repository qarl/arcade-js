// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_43e8 — memory-equivalent to the frozen oracle at ROM 0x43E8.
 *
 * GATE: strict unit-capture with the shared continuation SEVERED on both arms, plus an exhaustive
 *   crafted sweep, plus a whole-continuation arm, plus teeth. What it exercises, holes stated:
 *
 *   1. ★ THE ROUTINE TRANSFERS INTO A CHAIN THAT DOES NOT COME BACK HERE, so most arms replace
 *      that chain with a recorder on BOTH sides. What is then compared is this entry's own work:
 *      the total it computes, the pointer it leaves, and the whole machine it hands over. That is
 *      a narrowing and it is stated rather than implied.
 *   2. EQUAL at the real dispatch, with the chain severed — RAM, every register, and the state
 *      handed to the continuation all identical.
 *   3. EQUAL at the real dispatch with the chain RUNNING, which is the arm that proves the
 *      severing did not hide anything: the two sides are compared after the whole chain has run.
 *   4. EXCLUDED, deliberately: with the continuation severed, the flag byte alone — the flags
 *      the additions leave are not reproduced. With the chain RUNNING nothing is excluded at
 *      all, not even the stack pointer, because the chain returns on both sides.
 *   5. CORPUS — every dispatch of a driven session and of the undriven attract demo. ★ THIS
 *      ROUTINE FIRES ONCE PER SESSION on one fixed argument pair, so the corpus discriminates
 *      almost nothing and the crafted sweep is the load-bearing arm.
 *   6. EXHAUSTIVE over lengths, including the zero-length case a real run never presents, where
 *      a count of zero means a full 256 bytes rather than none.
 *   7. TEETH — five twins with their exact crafted catch counts.
 *
 * HOLE: nothing here establishes what the chain does with the total. That belongs to the chain.
 * HOLE: the pointer is fixed by the one caller in the image, so only the length is swept.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-43e8.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_43e8 } from "../loc_43e8.js";
import { loc_43e8 as oracle } from "../../translated/loc_43e8.js";
import { firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TARGET = 0x43e8;
const CONTINUATION = 0x07ad;
const CORPUS_FRAMES = 2500;

const REAL_BASE = 0x086b;
const REAL_LENGTH = 0x14;

const TAPES = [
  ["driven", {}],
  ["attract", { tape: [] }],
];
const DISPATCHES = { driven: 1, attract: 1 };

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

let entry = null;

function gate(candidate) {
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
  if (entry === null) gate(loc_43e8);
  return entry;
}

/**
 * A clone whose continuation is a recorder rather than the real chain, so a comparison sees this
 * entry's own product and the machine it hands on. The recorder is installed identically on both
 * arms, which is what keeps the comparison fair.
 */
function severed(machine, log) {
  const c = machine.clone();
  c.routines = new Map(c.routines);
  c.routines.set(CONTINUATION, (mm) => {
    log.push({ a: mm.regs.a, hl: mm.regs.hl, b: mm.regs.b, de: mm.regs.de });
  });
  return c;
}

/** Oracle vs candidate with the chain severed: RAM, registers, and the handover state. */
function unitDiff(candidate, machine) {
  const logA = [];
  const logB = [];
  const a = severed(machine, logA);
  const b = severed(machine, logB);
  oracle(a);
  candidate(b);
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  if (ram) return ram;
  if (logA.length !== logB.length) {
    return { addr: null, reg: "handovers", a: logA.length, b: logB.length };
  }
  for (const [i, x] of logA.entries()) {
    for (const k of ["a", "hl", "b"]) {
      if (x[k] !== logB[i][k]) return { addr: null, reg: `handover.${k}`, a: x[k], b: logB[i][k] };
    }
  }
  for (const k of ["a", "b", "h", "l"]) {
    if (a.regs[k] !== b.regs[k]) return { addr: null, reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

function craft(base, length) {
  const m = entryState().clone();
  m.regs.hl = base;
  m.regs.b = length;
  return m;
}

const LENGTH_SWEEP = [0, 1, 2, 3, 19, 20, 21, 64, 128, 200, 255];

function sweepCaught(candidate) {
  let caught = 0;
  for (const length of LENGTH_SWEEP) if (unitDiff(candidate, craft(REAL_BASE, length))) caught++;
  return caught;
}

function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  const args = new Set();
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      args.add(`${hex4(mm.regs.hl)}/${mm.regs.b}`);
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, args };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, loc_43e8) }));
  }
  return sessionCache;
}

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: computes the total but never hands on, so the chain does not run. */
function brokenSkipsTheChain(m) {
  const { regs, mem8 } = m;
  const run = regs.b === 0 ? 256 : regs.b;
  let total = 0;
  for (let i = 0; i < run; i++) total = (total + mem8[(regs.hl + i) & 0xffff]) & 0xff;
  regs.a = total;
  regs.hl = (regs.hl + run) & 0xffff;
  regs.b = 0;
}

/** BUG: sums one byte too few. */
function brokenShortByOne(m) {
  const { regs, mem8 } = m;
  const run = regs.b === 0 ? 256 : regs.b;
  let total = 0;
  for (let i = 0; i < run - 1; i++) total = (total + mem8[(regs.hl + i) & 0xffff]) & 0xff;
  regs.a = total;
  regs.hl = (regs.hl + run) & 0xffff;
  regs.b = 0;
  return m.call(CONTINUATION);
}

/** BUG: reads a length of zero as no bytes at all rather than as a full 256. */
function brokenZeroMeansNone(m) {
  const { regs, mem8 } = m;
  const run = regs.b;
  let total = 0;
  for (let i = 0; i < run; i++) total = (total + mem8[(regs.hl + i) & 0xffff]) & 0xff;
  regs.a = total;
  regs.hl = (regs.hl + run) & 0xffff;
  regs.b = 0;
  return m.call(CONTINUATION);
}

/** BUG: hands on the length it spent instead of the total it computed. */
function brokenHandsOnTheLength(m) {
  const { regs, mem8 } = m;
  const run = regs.b === 0 ? 256 : regs.b;
  let total = 0;
  for (let i = 0; i < run; i++) total = (total + mem8[(regs.hl + i) & 0xffff]) & 0xff;
  regs.a = run & 0xff;
  regs.hl = (regs.hl + run) & 0xffff;
  regs.b = 0;
  return m.call(CONTINUATION);
}

const TWINS = [
  ["no-op", brokenNoOp, 11],
  ["skips-the-chain", brokenSkipsTheChain, 11],
  // One crafted length escapes it, because a run one byte shorter can reach the same total.
  ["short-by-one", brokenShortByOne, 10],
  ["zero-means-none", brokenZeroMeansNone, 1],
  ["hands-on-the-length", brokenHandsOnTheLength, 11],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch, chain severed: total, pointer and handover identical", { skip }, () => {
  gate(loc_43e8);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const logA = [];
  const logB = [];
  const a = severed(entryState(), logA);
  const b = severed(entryState(), logB);
  oracle(a);
  loc_43e8(b);
  assert.equal(logA.length, 1, "vacuous: the oracle did not reach the continuation");
  assert.equal(logB.length, 1, "the rewrite did not reach the continuation");
  assert.deepEqual(logB[0], logA[0], "the state handed to the continuation differs");
  assert.equal(unitDiff(loc_43e8, entryState()), null, "the contract diverged");
  console.log(
    `  EQUAL: pointer=${hex4(REAL_BASE)} length=${entryState().regs.b}; hands on total=` +
      `${logA[0].a} pointer=${hex4(logA[0].hl)}`,
  );
});

test("EQUAL with the chain RUNNING: the severing hid nothing", { skip }, () => {
  const r = gate(loc_43e8);
  assert.equal(r.ram, null, `RAM diverged with the chain running — ${show(r.ram)}`);
  assert.equal(r.regs, null, `a register diverged with the chain running — ${JSON.stringify(r.regs)}`);
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_43e8(b);
  assert.equal(a.regs.sp, b.regs.sp, "the chain returns on both sides, so even sp must agree");
  console.log("  CHAIN RUNNING: RAM and every register identical, sp included");
});

test("EXCLUDED, deliberately: with the chain severed, only the flag byte moves", { skip }, () => {
  const logA = [];
  const logB = [];
  const a = severed(entryState(), logA);
  const b = severed(entryState(), logB);
  oracle(a);
  loc_43e8(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    ["f"],
    "with the chain severed the excluded set is the flag byte alone: the flags the additions " +
      "leave are NOT reproduced, and this asserts that the chain overwrites them before reading " +
      "any. The stack pointer does not appear because neither arm returns through the stack once " +
      "the continuation is a recorder",
  );
  console.log("  EXCLUDED: the flag byte only, and only while the continuation is severed");
});

test("CORPUS: every real dispatch replays identically, on a one-argument corpus", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} tape never reached the routine`);
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    assert.deepEqual(
      [...s.args],
      [`${hex4(REAL_BASE)}/${REAL_LENGTH}`],
      `the ${s.label} tape now presents a second argument pair`,
    );
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} dispatches over two sessions, one argument pair, identical`);
});

test("EXHAUSTIVE: every crafted length, the zero-length full run included", { skip }, () => {
  assert.equal(sweepCaught(loc_43e8), 0, "the rewrite diverged somewhere in the crafted space");
  const logA = [];
  const logB = [];
  const a = severed(craft(REAL_BASE, 0), logA);
  const b = severed(craft(REAL_BASE, 0), logB);
  oracle(a);
  loc_43e8(b);
  assert.equal(logA[0].hl, (REAL_BASE + 256) & 0xffff, "zero must walk a full 256 bytes");
  assert.equal(logB[0].hl, logA[0].hl, "the rewrite must walk the same full run");
  console.log(`  EXHAUSTIVE: ${LENGTH_SWEEP.length} crafted lengths identical`);
});

for (const [label, twin, craftedCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's crafted catch count moved`);
    assert.ok(craftedCaught > 0, `the ${label} twin is caught by nothing`);
    console.log(
      `  TEETH/${label}: caught on ${craftedCaught} of ${LENGTH_SWEEP.length} crafted entries`,
    );
  });
}

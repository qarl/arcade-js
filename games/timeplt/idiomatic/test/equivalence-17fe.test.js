// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_17fe — memory-equivalent to the frozen oracle at ROM 0x17FE.
 *
 * GATE: strict unit-capture with ONE exclusion, a replayed corpus of every dispatch, an
 *   exhaustive crafted sweep of the index, an arm that severs the arms themselves, and teeth.
 *   What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch, outside the dead stack scratch. The arms are still oracle
 *      routines that return through the stack, and the rewrite parks nothing for them, so each
 *      arm runs with the stack pointer two bytes higher than the oracle's arm does and its own
 *      pushes land two bytes higher too. The exclusion is exactly the bytes BELOW the entry stack
 *      pointer, and every arm PINS it — each walks the whole dump and asserts that no divergence
 *      escapes the window, so it cannot quietly widen.
 *   2. ★ WHY THAT IS SOUND HERE AND HAS TO BE RE-DERIVED ANYWHERE ELSE: this mode's shared tail
 *      is a bare return that the rewrite performs by doing nothing, so the arm's own return
 *      consumes this entry's return slot and the books balance. The stack pointer therefore
 *      AGREES on both sides, which the excluded-set arm asserts — it is not on the excluded list.
 *   3. EXCLUDED, deliberately: nothing but the stack scratch. Every register agrees, the stack
 *      pointer included, and the arm below pins that as an exact empty set.
 *   4. DISPATCH IS PROVED, not assumed: a severing arm replaces every reachable arm address with
 *      a recorder on both sides and asserts that the SAME arm was chosen, and that the registers
 *      the table lookup leaves behind reach it identically.
 *   5. CORPUS — every dispatch of the driven tape. ★ THE UNDRIVEN DEMO NEVER REACHES THIS MODE,
 *      and the corpus arm asserts that rather than skipping it silently.
 *   6. EXHAUSTIVE over the index: all 256 values through the severing recorder, which is the only
 *      arm that can reach the out-of-table indices — the table is short and the index is used
 *      raw, so most values select bytes that are not an arm address at all.
 *   7. TEETH — five twins, each caught by a named arm.
 *
 * HOLE: the corpus presents four of the table's entries and no more; every other index is covered
 * only through the recorder, so what those arms DO is not exercised anywhere in this file.
 * HOLE: this file does not establish how long the table is. It asserts what the ROM bytes select
 * for each index, which is a different and weaker claim.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-17fe.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_17fe } from "../loc_17fe.js";
import { SEQUENCE_SUBSTEP } from "../names.js";
import { loc_17fe as oracle } from "../../translated/loc_17fe.js";
import { firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TARGET = 0x17fe;
const ARM_TABLE = 0x1806;
const CORPUS_FRAMES = 2500;

/**
 * The widest divergence any dispatch of the corpus produces, in bytes below the entry stack
 * pointer. Measured, and asserted as an exact ceiling rather than assumed.
 */
const SCRATCH_BYTES = 10;

const TAPES = [
  ["driven", {}],
  ["attract", { tape: [] }],
];
const DISPATCHES = { driven: 100, attract: 0 };

/** The indices the driven tape presents, and the arm each selects. Measured, asserted as a set. */
const REAL_INDICES = [0, 1, 2, 3];

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
  if (entry === null) gate(loc_17fe);
  return entry;
}

/** The arm the ROM bytes select for an index: the doubling wraps at eight bits. */
function armFor(machine, index) {
  return machine.mem16[(ARM_TABLE + ((index + index) & 0xff)) & 0xffff];
}

/** Every differing byte of two dumps, as {addr, a, b} — the scratch window included. */
function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

/** Oracle vs candidate on clones of one machine: masked RAM, then every register. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  if (moved.length) return { addr: null, reg: moved[0], a: a.regs[moved[0]], b: b.regs[moved[0]] };
  return null;
}

/**
 * A clone in which EVERY address the table can select is a recorder, on both arms. This is the
 * only way to reach the indices past the end of the table, whose selected words are not routines.
 */
function severed(machine, log) {
  const c = machine.clone();
  c.routines = new Map(c.routines);
  for (let index = 0; index < 256; index++) {
    const arm = armFor(machine, index);
    c.routines.set(arm, (mm) => {
      log.push({ arm, a: mm.regs.a, hl: mm.regs.hl, de: mm.regs.de, sp: mm.regs.sp });
      mm.ret();
    });
  }
  return c;
}

function craft(index) {
  const m = entryState().clone();
  m.mem8[SEQUENCE_SUBSTEP] = index;
  return m;
}

/** Which arm each side chose, and what it was handed, for one crafted index. */
function dispatchDiff(index) {
  const logA = [];
  const logB = [];
  const a = severed(craft(index), logA);
  const b = severed(craft(index), logB);
  oracle(a);
  loc_17fe(b);
  if (logA.length !== logB.length) return { index, a: logA.length, b: logB.length };
  for (const [i, x] of logA.entries()) {
    for (const k of ["arm", "a", "hl", "de"]) {
      if (x[k] !== logB[i][k]) return { index, key: k, a: x[k], b: logB[i][k] };
    }
  }
  return null;
}

function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  let widest = 0;
  const indices = new Set();
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      indices.add(mm.mem8[SEQUENCE_SUBSTEP]);
      const sp = mm.regs.sp;
      const a = mm.clone();
      const b = mm.clone();
      oracle(a);
      candidate(b);
      const diffs = allDiffs(a, b);
      for (const d of diffs) if (d.addr !== null && d.addr < sp) widest = Math.max(widest, sp - d.addr);
      const stray = diffs.find((d) => !inScratch(d.addr, sp));
      const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
      if (stray || moved.length) caught++;
      return oracle(mm);
    }]]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, widest, indices };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, loc_17fe) }));
  }
  return sessionCache;
}

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: masks the index to the table's length instead of using it raw. */
function brokenMasksTheIndex(m) {
  const { regs, mem8, mem16 } = m;
  const index = mem8[SEQUENCE_SUBSTEP] & 0x07;
  const at = (ARM_TABLE + ((index + index) & 0xff)) & 0xffff;
  regs.a = at & 0xff;
  regs.de = (at + 2) & 0xffff;
  regs.hl = mem16[at];
  return m.call(mem16[at]);
}

/** BUG: doubles the index into sixteen bits, so a large index runs off the table's page. */
function brokenWideIndex(m) {
  const { regs, mem8, mem16 } = m;
  const index = mem8[SEQUENCE_SUBSTEP];
  const at = (ARM_TABLE + index + index) & 0xffff;
  regs.a = at & 0xff;
  regs.de = (at + 2) & 0xffff;
  regs.hl = mem16[at];
  return m.call(mem16[at]);
}

/** BUG: forgets the by-products the lookup leaves for the arm to read. */
function brokenDropsLookupResidue(m) {
  const { mem8, mem16 } = m;
  const index = mem8[SEQUENCE_SUBSTEP];
  const at = (ARM_TABLE + ((index + index) & 0xff)) & 0xffff;
  return m.call(mem16[at]);
}

/** BUG: reads the table one entry along, so every index selects its neighbour's arm. */
function brokenOffByOneEntry(m) {
  const { regs, mem8, mem16 } = m;
  const index = mem8[SEQUENCE_SUBSTEP] + 1;
  const at = (ARM_TABLE + ((index + index) & 0xff)) & 0xffff;
  regs.a = at & 0xff;
  regs.de = (at + 2) & 0xffff;
  regs.hl = mem16[at];
  return m.call(mem16[at]);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["masks-the-index", brokenMasksTheIndex],
  ["wide-index", brokenWideIndex],
  ["drops-lookup-residue", brokenDropsLookupResidue],
  ["off-by-one-entry", brokenOffByOneEntry],
];

/** Measured: how many of the driven session's dispatches each twin is caught on. */
const CAUGHT = {
  "no-op": 100,
  "masks-the-index": 0,
  "wide-index": 0,
  "drops-lookup-residue": 26,
  "off-by-one-entry": 100,
};

/** Measured: how many of the 256 crafted indices each twin picks a different arm for. */
const MISDISPATCHED = {
  "masks-the-index": 240,
  "wide-index": 128,
  // Two indices escape it: an entry whose neighbour holds the same word cannot be told apart.
  "off-by-one-entry": 254,
};

function misdispatched(candidate) {
  let n = 0;
  for (let index = 0; index < 256; index++) {
    const logA = [];
    const logB = [];
    const a = severed(craft(index), logA);
    const b = severed(craft(index), logB);
    oracle(a);
    // A twin can select a word the recorder map does not cover, which IS a misdispatch: the
    // recorder covers exactly the addresses the correct lookup can reach.
    try {
      candidate(b);
    } catch {
      n++;
      continue;
    }
    const sameArm = logA.length === logB.length && logA.every((x, i) => x.arm === logB[i].arm);
    if (!sameArm) n++;
  }
  return n;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the dead stack scratch", { skip }, () => {
  const r = gate(loc_17fe);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_17fe(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.ok(r.ram === null || inScratch(r.ram.addr, sp), "the raw diff left the window");
  console.log(
    `  EQUAL: entry index=${entryState().mem8[SEQUENCE_SUBSTEP]} sp=${hex4(sp)}; identical ` +
      `outside [sp-${SCRATCH_BYTES}, sp)`,
  );
});

test("NOT VACUOUS: the same masked comparison catches a candidate that does nothing", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a do-nothing candidate, so it is not a gate");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${JSON.stringify(d)}`);
});

test("★ EXCLUDED is the scratch window ALONE: the stack pointer AGREES", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_17fe(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    [],
    "a register moved. The stack pointer in particular MUST agree: this mode's tail is a bare " +
      "return the rewrite performs by doing nothing, so the arm's own return consumes this " +
      "entry's return slot and the books balance. If sp appears here, that reasoning has broken " +
      "and the routine leaks two bytes of stack per dispatch",
  );
  console.log("  EXCLUDED: no register at all, sp included — only the dead scratch differs");
});

test("DISPATCH: both sides choose the same arm and hand it the same lookup residue", { skip }, () => {
  for (const index of REAL_INDICES) {
    assert.equal(dispatchDiff(index), null, `index ${index} dispatched differently`);
  }
  const logA = [];
  const a = severed(craft(REAL_INDICES[0]), logA);
  oracle(a);
  assert.equal(logA.length, 1, "vacuous: the severing recorder never fired");
  console.log(
    `  DISPATCH: indices ${REAL_INDICES.join(",")} select ` +
      `${REAL_INDICES.map((i) => hex4(armFor(entryState(), i))).join(",")}`,
  );
});

test("CORPUS: every driven dispatch replays identically; the demo never reaches this mode", { skip }, () => {
  const seen = sessions();
  for (const s of seen) {
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
  }
  const driven = seen.find((s) => s.label === "driven");
  assert.ok(driven.dispatches > 0, "vacuous: the driven tape no longer reaches the routine");
  assert.deepEqual(
    [...driven.indices].sort((x, y) => x - y),
    REAL_INDICES,
    "the driven index set moved, so the crafted sweep covers the wrong hole",
  );
  assert.equal(
    driven.widest,
    SCRATCH_BYTES,
    "the widest scratch divergence moved, so the exclusion is the wrong size — it is asserted " +
      "as an exact ceiling precisely so that a change shows up here rather than being absorbed",
  );
  console.log(
    `  CORPUS: driven ${driven.dispatches} dispatches over indices ${[...driven.indices]}; ` +
      `widest scratch divergence sp-${driven.widest}; demo ${DISPATCHES.attract}`,
  );
});

test("EXHAUSTIVE: all 256 indices select the same arm on both sides", { skip }, () => {
  for (let index = 0; index < 256; index++) {
    assert.equal(dispatchDiff(index), null, `index ${index} dispatched differently`);
  }
  // The doubling wraps at eight bits, so the index past the halfway mark folds back onto the head
  // of the table. That is asserted as a property rather than left to the sweep to imply.
  assert.equal(armFor(entryState(), 128), armFor(entryState(), 0), "128 must fold onto 0");
  assert.equal(armFor(entryState(), 129), armFor(entryState(), 1), "129 must fold onto 1");
  console.log("  EXHAUSTIVE: 256 indices identical, the eight-bit fold included");
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const r = replaySession({}, twin);
    assert.equal(r.dispatches, DISPATCHES.driven, "the driven dispatch count moved");
    assert.equal(r.caught, CAUGHT[label], `the ${label} twin's driven catch count moved`);
    console.log(`  TEETH/${label}: caught on ${r.caught} of ${r.dispatches} real dispatches`);
  });
}

for (const [label, twin] of TWINS.filter(([l]) => l in MISDISPATCHED)) {
  test(`TEETH: the ${label} twin misdispatches an exact count of crafted indices`, { skip }, () => {
    assert.equal(misdispatched(twin), MISDISPATCHED[label], `the ${label} twin's count moved`);
    console.log(`  TEETH/${label}: misdispatches ${MISDISPATCHED[label]} of 256 indices`);
  });
}

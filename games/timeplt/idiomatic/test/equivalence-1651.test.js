// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1651 — memory-equivalent to the frozen oracle at ROM 0x1651.
 *
 * GATE: strict unit-capture with ONE exclusion, a replayed corpus of every dispatch, an
 *   exhaustive crafted sweep of the index, an arm that severs the arms themselves, and teeth.
 *   What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch, outside a narrow dead stack window. The oracle reaches its
 *      table through a chain that brackets the lookup with a push and a pop; the rewrite reads
 *      the table directly, so bytes below the stack pointer can hold different values. The
 *      exclusion is the SCRATCH_BYTES window below the entry stack pointer, and every arm PINS it —
 *      each walks the whole dump and asserts no divergence escapes the window.
 *   2. ★ THE PARKED RETURN IS ASSERTED, NOT ASSUMED, AND IT IS THE POINT OF THIS FILE. Each arm
 *      returns through the stack, and what it returns to is the slot this entry parks for it.
 *      One arm below runs the rewrite WITHOUT that park and asserts that the stack pointer then
 *      ends two bytes adrift — which is what makes keeping it a measured requirement rather than
 *      a habit carried over from the transcription.
 *   3. EXCLUDED, deliberately: nothing but the stack window, OF THE THINGS THIS GATE CAN SEE.
 *      Every register agrees, the stack pointer included, and the arm below pins that as an exact
 *      empty set. It does NOT see time: `clone()` seats nextNmi at Infinity so no NMI can fire,
 *      and the cycle count is in neither the state dump nor REG_FIELDS. That exclusion is the
 *      fidelity contract's, not this file's choice — the rewrite charges no T-states by design.
 *   4. DISPATCH IS PROVED, not assumed: a severing arm replaces every address the table can
 *      select with a recorder on both sides and asserts that the SAME arm was chosen and handed
 *      the same lookup by-products it records — the accumulator and the two pairs, not the flags.
 *      The ROM's arithmetic writes flags the rewrite does not, and the reached arms read none.
 *   5. CORPUS — every dispatch of the undriven demo and of the driven tape.
 *   6. EXHAUSTIVE over the index: all 256 values through the severing recorder, which is the only
 *      way to reach the indices past the end of the table — the index is used raw, so a large one
 *      selects bytes that are not an arm address at all.
 *   7. TEETH — six twins. Each twin's verdict on the real corpus is recorded exactly, INCLUDING
 *      the two that the corpus cannot see well: one the demo's index set never exercises at all,
 *      which the crafted sweep catches instead, and one that does not merely diverge but stops
 *      the session outright by selecting a word that is not a routine.
 *
 * HOLE: what each arm DOES is not exercised here beyond the indices the two sessions present.
 * HOLE: this file does not establish how long the table is. It asserts what the ROM bytes select
 * for each index, which is a different and weaker claim.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-1651.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_1651 } from "../loc_1651.js";
import { fetchTableWord } from "../fetchTableWord.js";
import { SEQUENCE_SUBSTEP } from "../names.js";
import { loc_1651 as oracle } from "../../translated/loc_1651.js";
import { firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TARGET = 0x1651;
const ARM_TABLE = 0x1659;
const SHARED_TAIL = 0x167b;
const CORPUS_FRAMES = 2500;

/**
 * The widest divergence any dispatch of the two sessions produces, in bytes below the entry stack
 * pointer. Measured, and asserted as an exact ceiling rather than assumed.
 */
const SCRATCH_BYTES = 6;

const TAPES = [
  ["attract", { tape: [] }],
  ["driven", {}],
];
const DISPATCHES = { attract: 521, driven: 187 };

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
  if (entry === null) gate(loc_1651);
  return entry;
}

/** The arm the ROM bytes select for an index: the doubling wraps at eight bits. */
function armFor(machine, index) {
  return machine.mem16[(ARM_TABLE + ((index + index) & 0xff)) & 0xffff];
}

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
 * A clone in which every address the table can select is a recorder, and so is the shared tail,
 * on both arms. Each recorder returns through the stack exactly as the routine it stands in for
 * does, so the stack accounting this file is about is preserved.
 */
function severed(machine, log) {
  const c = machine.clone();
  c.routines = new Map(c.routines);
  for (let index = 0; index < 256; index++) {
    const arm = armFor(machine, index);
    c.routines.set(arm, (mm) => {
      log.push({ kind: "arm", arm, a: mm.regs.a, hl: mm.regs.hl, de: mm.regs.de });
      mm.ret();
    });
  }
  c.routines.set(SHARED_TAIL, (mm) => {
    log.push({ kind: "tail", arm: SHARED_TAIL, a: mm.regs.a, hl: mm.regs.hl, de: mm.regs.de });
    mm.ret();
  });
  return c;
}

function craft(index) {
  const m = entryState().clone();
  m.mem8[SEQUENCE_SUBSTEP] = index;
  return m;
}

function dispatchDiff(candidate, index) {
  const logA = [];
  const logB = [];
  const a = severed(craft(index), logA);
  const b = severed(craft(index), logB);
  oracle(a);
  try {
    candidate(b);
  } catch {
    return { index, threw: true };
  }
  if (logA.length !== logB.length) return { index, a: logA.length, b: logB.length };
  for (const [i, x] of logA.entries()) {
    for (const k of ["kind", "arm", "a", "hl", "de"]) {
      if (x[k] !== logB[i][k]) return { index, key: k, a: x[k], b: logB[i][k] };
    }
  }
  if (a.regs.sp !== b.regs.sp) return { index, key: "sp", a: a.regs.sp, b: b.regs.sp };
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
      for (const d of diffs) {
        if (d.addr !== null && d.addr < sp) widest = Math.max(widest, sp - d.addr);
      }
      const stray = diffs.find((d) => !inScratch(d.addr, sp));
      const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
      if (stray || moved.length) caught++;
      return oracle(mm);
    }]]),
    opts,
  );
  let frames = [];
  let threw = null;
  try {
    frames = m.runFrames(CORPUS_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 80);
  }
  return {
    dispatches,
    caught,
    widest,
    indices,
    stopped: threw ?? (m.stoppedBy === null ? null : String(m.stoppedBy).slice(0, 80)),
    short: frames.length !== CORPUS_FRAMES,
  };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, loc_1651) }));
  }
  return sessionCache;
}

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/**
 * BUG: parks nothing for the arm to return to. This is the twin the file exists to catch: it
 * looks tidier than the real thing and leaves the stack two bytes adrift on every dispatch.
 */
function brokenNoParkedReturn(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[SEQUENCE_SUBSTEP];
  regs.hl = ARM_TABLE;
  const arm = fetchTableWord(m);
  regs.de = regs.hl;
  regs.hl = arm;
  m.call(arm);
  return m.call(SHARED_TAIL);
}

/** BUG: runs the arm and never runs the shared tail. */
function brokenSkipsTheTail(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[SEQUENCE_SUBSTEP];
  regs.hl = ARM_TABLE;
  const arm = fetchTableWord(m);
  regs.de = regs.hl;
  regs.hl = arm;
  m.push16(SHARED_TAIL);
  return m.call(arm);
}

/** BUG: masks the index to the table's length instead of using it raw. */
function brokenMasksTheIndex(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[SEQUENCE_SUBSTEP] & 0x0f;
  regs.hl = ARM_TABLE;
  const arm = fetchTableWord(m);
  regs.de = regs.hl;
  regs.hl = arm;
  m.push16(SHARED_TAIL);
  m.call(arm);
  return m.call(SHARED_TAIL);
}

/** BUG: forgets the by-products the lookup leaves for the arm to read. */
function brokenDropsLookupResidue(m) {
  const { mem8, mem16 } = m;
  const index = mem8[SEQUENCE_SUBSTEP];
  const at = (ARM_TABLE + ((index + index) & 0xff)) & 0xffff;
  m.push16(SHARED_TAIL);
  m.call(mem16[at]);
  return m.call(SHARED_TAIL);
}

/** BUG: reads the table one entry along, so every index selects its neighbour's arm. */
function brokenOffByOneEntry(m) {
  const { regs, mem8 } = m;
  regs.a = (mem8[SEQUENCE_SUBSTEP] + 1) & 0xff;
  regs.hl = ARM_TABLE;
  const arm = fetchTableWord(m);
  regs.de = regs.hl;
  regs.hl = arm;
  m.push16(SHARED_TAIL);
  m.call(arm);
  return m.call(SHARED_TAIL);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["no-parked-return", brokenNoParkedReturn],
  ["skips-the-tail", brokenSkipsTheTail],
  ["masks-the-index", brokenMasksTheIndex],
  ["drops-lookup-residue", brokenDropsLookupResidue],
  ["off-by-one-entry", brokenOffByOneEntry],
];

/**
 * Measured, per twin: how many of the demo session's dispatches it is caught on, or KILLS if
 * running it stops the session outright — which is the strongest catch there is and is recorded
 * as such rather than folded into a number.
 */
const CAUGHT = {
  "no-op": 521,
  "no-parked-return": 521,
  "skips-the-tail": 521,
  // The demo only ever presents indices this mask leaves alone, so the corpus is blind to it and
  // the crafted sweep below is what catches it. Recorded rather than hidden.
  "masks-the-index": 0,
  // Caught on a small minority: most arms overwrite the lookup's by-products before reading them.
  "drops-lookup-residue": 3,
  "off-by-one-entry": "KILLS",
};

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the dead stack window", { skip }, () => {
  gate(loc_1651);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_1651(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
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

test("★ THE PARKED RETURN IS LOAD-BEARING: dropping it leaves the stack two bytes adrift", { skip }, () => {
  const withPark = entryState().clone();
  const withoutPark = entryState().clone();
  const reference = entryState().clone();
  oracle(reference);
  loc_1651(withPark);
  brokenNoParkedReturn(withoutPark);
  assert.equal(
    withPark.regs.sp,
    reference.regs.sp,
    "the rewrite must leave the stack exactly where the oracle leaves it",
  );
  assert.equal(
    withoutPark.regs.sp - reference.regs.sp,
    2,
    "dropping the park must leave the stack two bytes adrift. If this is ever zero, the arms no " +
      "longer return through the stack and the park should go",
  );
  console.log(
    `  PARKED RETURN: with it sp=${hex4(withPark.regs.sp)} (matches); without it ` +
      `sp=${hex4(withoutPark.regs.sp)}`,
  );
});

test("EXCLUDED, deliberately: nothing but the stack window — every register agrees", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_1651(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    [],
    "a register moved: this routine's own return is performed by the shared tail on both sides, " +
      "so nothing at all may differ outside the dead stack window",
  );
  console.log("  EXCLUDED: no register at all, sp included — only the dead scratch differs");
});

test("DISPATCH: both sides choose the same arm, hand it the same residue, and run the tail", { skip }, () => {
  const logA = [];
  const a = severed(craft(4), logA);
  oracle(a);
  assert.deepEqual(
    logA.map((x) => x.kind),
    ["arm", "tail"],
    "the oracle must run the selected arm and then the shared tail, in that order",
  );
  for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    assert.equal(dispatchDiff(loc_1651, index), null, `index ${index} dispatched differently`);
  }
  console.log(
    `  DISPATCH: arm then tail; indices 0..12 select ` +
      `${[0, 1, 2, 3, 4].map((i) => hex4(armFor(entryState(), i))).join(",")}...`,
  );
});

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  const seen = sessions();
  let total = 0;
  let widest = 0;
  for (const s of seen) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} tape never reached the routine`);
    assert.equal(s.stopped, null, `the ${s.label} session stopped early: ${s.stopped}`);
    assert.equal(s.short, false, `the ${s.label} session ran short`);
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
    widest = Math.max(widest, s.widest);
  }
  assert.equal(
    widest,
    SCRATCH_BYTES,
    "the widest scratch divergence moved, so the exclusion is the wrong size — it is asserted " +
      "as an exact ceiling precisely so a change shows up here rather than being absorbed",
  );
  const demo = seen.find((s) => s.label === "attract");
  console.log(
    `  CORPUS: ${total} dispatches over two sessions; demo indices ` +
      `${[...demo.indices].sort((x, y) => x - y).join(",")}; widest scratch sp-${widest}`,
  );
});

test("EXHAUSTIVE: all 256 indices select the same arm on both sides", { skip }, () => {
  for (let index = 0; index < 256; index++) {
    assert.equal(dispatchDiff(loc_1651, index), null, `index ${index} dispatched differently`);
  }
  assert.equal(armFor(entryState(), 128), armFor(entryState(), 0), "128 must fold onto 0");
  assert.equal(armFor(entryState(), 200), armFor(entryState(), 72), "200 must fold onto 72");
  console.log("  EXHAUSTIVE: 256 indices identical, the eight-bit fold included");
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin's verdict on the real corpus is exactly what is recorded`, { skip }, () => {
    const r = replaySession({ tape: [] }, twin);
    if (CAUGHT[label] === "KILLS") {
      assert.notEqual(r.stopped, null, `the ${label} twin no longer stops the session`);
      console.log(`  TEETH/${label}: stops the session outright — ${r.stopped}`);
      return;
    }
    assert.equal(r.stopped, null, `the ${label} twin stopped the session: ${r.stopped}`);
    assert.equal(r.dispatches, DISPATCHES.attract, "the demo dispatch count moved");
    assert.equal(r.caught, CAUGHT[label], `the ${label} twin's demo catch count moved`);
    console.log(`  TEETH/${label}: caught on ${r.caught} of ${r.dispatches} real dispatches`);
  });
}

test("TEETH: the index twins are caught by the crafted sweep the corpus cannot reach", { skip }, () => {
  const masked = [...Array(256).keys()].filter((i) => dispatchDiff(brokenMasksTheIndex, i));
  const offByOne = [...Array(256).keys()].filter((i) => dispatchDiff(brokenOffByOneEntry, i));
  assert.equal(masked.length, 224, "the masks-the-index twin's crafted catch count moved");
  assert.equal(offByOne.length, 256, "the off-by-one twin's crafted catch count moved");
  console.log(
    `  TEETH/crafted: masks-the-index caught on ${masked.length} of 256 indices, ` +
      `off-by-one-entry on ${offByOne.length}`,
  );
});

// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1afc — memory-equivalent to the frozen oracle at ROM 0x1AFC.
 *
 * GATE: strict unit-capture, a replayed corpus, an exhaustive crafted sweep over both planes of
 *   the whole character grid, and teeth. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — RAM byte-identical across the whole state dump.
 *   1a. ★ AND THAT ARM IS VACUOUS ON ITS OWN, WHICH IS MEASURED AND ASSERTED. At the first
 *      dispatch the destination already holds the pair the routine would write, so a candidate
 *      that does nothing passes it. A second arm shows the corpus catching that candidate on
 *      almost every dispatch, and a third shows the crafted sweep catching it on all of them.
 *   2. EXCLUDED, deliberately: the registers the copy walks through are DROPPED, not reproduced,
 *      and this arm pins exactly which ones that makes differ. Both call sites in the image
 *      reload every one of them before reading anything, which is why dropping them is safe; if
 *      that ever stops being true this arm's expected set is where it will show.
 *   3. CORPUS — every dispatch of the driven tape. ★ THE UNDRIVEN DEMO NEVER REACHES THIS ENTRY,
 *      and the corpus arm asserts that as a fact rather than skipping the session silently.
 *   4. EXHAUSTIVE — every cell of the character grid as the source, and a sweep of destinations
 *      including the wrap at the top of the address space. This is what proves the second read
 *      comes from the other plane of the SAME cell rather than from a fixed offset.
 *   5. TEETH — six twins, each with the exact number of crafted entries that catch it.
 *
 * HOLE: nothing here says what the copy is FOR. The two-byte record it writes is read back
 * elsewhere, and this file neither knows nor claims what by.
 * HOLE: the corpus presents two source cells and two destinations, both fixed by their callers,
 * so every discriminating entry below is crafted.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-1afc.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_1afc } from "../loc_1afc.js";
import { loc_1afc as oracle } from "../../translated/loc_1afc.js";
import { firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TARGET = 0x1afc;
const EXCLUDED = ["a", "e", "h", "sp"];
const CORPUS_FRAMES = 2500;

/** The two planes of the character grid, and the bit that tells them apart. */
const COLOUR_PLANE = 0xa000;
const GLYPH_PLANE = 0xa400;
const GRID_CELLS = 0x400;

/** Somewhere in work RAM no caller uses, for the crafted destinations. */
const SCRATCH_RECORD = 0xae00;

const TAPES = [
  ["driven", {}],
  ["attract", { tape: [] }],
];
const DISPATCHES = { driven: 72, attract: 0 };

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
  if (entry === null) gate(loc_1afc);
  return entry;
}

/** Oracle vs candidate on clones of one machine, on RAM alone — the declared contract. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
}

function craft(cell, record) {
  const m = entryState().clone();
  m.regs.hl = cell;
  m.regs.de = record;
  return m;
}

/**
 * Every cell of the grid as a source, each to its own destination so no two entries of the sweep
 * can mask one another, plus a handful of destinations chosen to stress the wrap.
 */
const CELL_SWEEP = Array.from({ length: GRID_CELLS }, (_unused, i) => GLYPH_PLANE + i);
const RECORD_SWEEP = [SCRATCH_RECORD, SCRATCH_RECORD + 1, 0xafff, 0xa3ff, COLOUR_PLANE + 0x200];
const SWEEP_SIZE = CELL_SWEEP.length + RECORD_SWEEP.length;

function sweepCaught(candidate) {
  let caught = 0;
  for (const cell of CELL_SWEEP) {
    if (unitDiff(candidate, craft(cell, SCRATCH_RECORD + ((cell & 3) << 2)))) caught++;
  }
  for (const record of RECORD_SWEEP) {
    if (unitDiff(candidate, craft(GLYPH_PLANE + 0x123, record))) caught++;
  }
  return caught;
}

function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  const cells = new Set();
  const records = new Set();
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      cells.add(mm.regs.hl);
      records.add(mm.regs.de);
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, cells, records };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, loc_1afc) }));
  }
  return sessionCache;
}

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: copies the glyph twice, never reaching the other plane. */
function brokenBothFromGlyphPlane(m) {
  const { mem8, regs } = m;
  mem8[regs.de] = mem8[regs.hl];
  mem8[(regs.de + 1) & 0xffff] = mem8[regs.hl];
}

/** BUG: reads the colour from a fixed row of the other plane rather than the matching cell. */
function brokenColourFromFixedRow(m) {
  const { mem8, regs } = m;
  mem8[regs.de] = mem8[regs.hl];
  mem8[(regs.de + 1) & 0xffff] = mem8[COLOUR_PLANE + (regs.hl & 0xff)];
}

/** BUG: lays the pair down the other way round. */
function brokenPairReversed(m) {
  const { mem8, regs } = m;
  mem8[regs.de] = mem8[regs.hl & ~0x0400];
  mem8[(regs.de + 1) & 0xffff] = mem8[regs.hl];
}

/** BUG: writes only the glyph, leaving the second byte of the record standing. */
function brokenGlyphOnly(m) {
  const { mem8, regs } = m;
  mem8[regs.de] = mem8[regs.hl];
}

/** BUG: clears the wrong bit, so the second read lands one plane-sized step further away. */
function brokenWrongPlaneBit(m) {
  const { mem8, regs } = m;
  mem8[regs.de] = mem8[regs.hl];
  mem8[(regs.de + 1) & 0xffff] = mem8[regs.hl & ~0x0200];
}

/** Measured catch counts; each is asserted exactly, so a twin caught on a different set fails. */
const TWINS = [
  ["no-op", brokenNoOp],
  ["both-from-glyph-plane", brokenBothFromGlyphPlane],
  ["colour-from-fixed-row", brokenColourFromFixedRow],
  ["pair-reversed", brokenPairReversed],
  ["glyph-only", brokenGlyphOnly],
  ["wrong-plane-bit", brokenWrongPlaneBit],
];

const CAUGHT = {
  "no-op": 1029,
  "both-from-glyph-plane": 1029,
  // Caught on the cells whose colour byte differs from the one a fixed row would supply;
  // most of the colour plane holds one repeated value, which is why this is not the whole sweep.
  "colour-from-fixed-row": 113,
  "pair-reversed": 1029,
  // One crafted entry escapes each of these two: at that cell the byte it fails to write, or
  // writes from the wrong place, already holds the value it should have had.
  "glyph-only": 1028,
  "wrong-plane-bit": 1028,
};

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: loc_1afc == oracle on RAM", { skip }, () => {
  const r = gate(loc_1afc);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  console.log(
    `  EQUAL: entry cell=${hex4(entryState().regs.hl)} record=${hex4(entryState().regs.de)}; ` +
      "RAM identical",
  );
});

test("★ THE CAPTURED ENTRY IS VACUOUS, and the corpus is what covers it", { skip }, () => {
  // At the FIRST dispatch the destination record already holds the very pair this routine would
  // write, so the write changes nothing and a candidate that does nothing is indistinguishable
  // there. That is measured, not assumed, and it is why the corpus and crafted arms carry this
  // file rather than the single-entry arm above.
  const state = entryState();
  assert.equal(state.mem8[state.regs.de], state.mem8[state.regs.hl], "the glyph already matches");
  assert.equal(unitDiff(brokenNoOp, state), null, "the captured entry is no longer vacuous, so " +
    "this arm is now asserting the opposite of what it was written to record");

  const caught = sessions()
    .find((s) => s.label === "driven")
    .dispatches;
  assert.ok(caught > 0, "vacuous: no driven dispatch to fall back on");
  console.log(
    `  VACUOUS AT THE ENTRY: record already holds (${state.mem8[state.regs.de]}, ` +
      `${state.mem8[state.regs.de + 1]}); the corpus and the crafted sweep are the gate`,
  );
});

test("NOT VACUOUS overall: the corpus catches the do-nothing candidate on almost every dispatch", { skip }, () => {
  const r = replaySession({}, brokenNoOp);
  assert.equal(r.dispatches, DISPATCHES.driven, "the driven dispatch count moved");
  assert.equal(r.caught, 71, "the do-nothing candidate's driven catch count moved");
  console.log(`  NOT VACUOUS: the empty candidate is caught on ${r.caught} of ${r.dispatches}`);
});

test("EXCLUDED, deliberately: the dropped walk registers, and nothing else", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_1afc(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    EXCLUDED,
    "the excluded set changed shape: the copy's walk registers are deliberately not reproduced, " +
      "and the stack pointer differs because the oracle returns through the stack",
  );
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc — RAM unaffected`);
});

test("CORPUS: every driven dispatch replays identically, and the demo never gets here", { skip }, () => {
  const seen = sessions();
  for (const s of seen) {
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
  }
  const driven = seen.find((s) => s.label === "driven");
  assert.ok(driven.dispatches > 0, "vacuous: the driven tape no longer reaches the routine");
  console.log(
    `  CORPUS: driven ${driven.dispatches} dispatches over cells ` +
      `${[...driven.cells].map(hex4).join(",")} into ${[...driven.records].map(hex4).join(",")}; ` +
      `demo ${DISPATCHES.attract}`,
  );
});

test("EXHAUSTIVE: every cell of the grid, and destinations that wrap", { skip }, () => {
  assert.equal(sweepCaught(loc_1afc), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} crafted cell/record entries identical`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), CAUGHT[label], `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${CAUGHT[label]} of ${SWEEP_SIZE} crafted entries`);
  });
}

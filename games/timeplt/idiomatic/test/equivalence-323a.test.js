// SPDX-License-Identifier: GPL-3.0-only
/**
 * stepCraftFlightScript — memory-equivalent to the frozen oracle at ROM 0x323A.
 *
 * GATE: every dispatch of two real tapes replayed, plus an exhaustive crafted sweep of the two
 *   record bytes that decide the outcome. What it exercises, holes stated:
 *
 *   1. CORPUS — every dispatch of the shared coin -> start tape and of undriven attract, each a
 *      whole-state-dump comparison outside the scratch window.
 *   2. THE DEAD STACK SCRATCH IS THE ONE EXCLUSION, pinned to [SP-4, SP): the oracle pushes a
 *      return address for each of the two lookups it delegates, and the rewrite models no stack.
 *      Every arm walks the whole dump and asserts nothing escapes it.
 *   3. REGISTERS AND PC ARE EXCLUDED, DELIBERATELY, as a ceiling: the flag byte and sp, the dead
 *      table pointer in d/e, and the new count in c and the entry pointer in h/l that the two
 *      frozen lookups leave behind. The rewrite hands the count and the pointer to the lookups as
 *      arguments and leaves no register behind, so the accumulator is the only register held.
 *   3a. DEAD AT EXIT — c, h and l flipped on the FROZEN game at every exit of this routine, over a
 *      coin-start session and undriven attract, change nothing, while flipping SP at the same exit
 *      is heard. That is the ORACLE's word that nobody reads what the rewrite no longer leaves.
 *   4. THE EARLY EXIT IS A REAL BRANCH — a timer already at zero must leave the whole dump
 *      untouched, which is measured off the ORACLE rather than assumed from the rewrite.
 *   5. EXHAUSTIVE — all 256 timer values crossed with a spread of run selectors, on a painted
 *      record so both the timer and the shape byte are visible wherever they land.
 *   6. THE RUN IS WALKED BACKWARDS — the shape byte for two adjacent timer values comes from two
 *      adjacent entries of the run, in the direction counting down implies. Asserted against
 *      poked run bytes, so it could have come out the other way.
 *   7. TEETH — eight twins, each with its exact catch count over the sweep. The no-floor twin's
 *      count of four is the whole of the branch it breaks: it differs only where the timer is
 *      already zero, which is one entry of the sweep per selector. The three wrong-entry twins are
 *      caught only where the wrong entry holds a different shape byte (see TWINS).
 *
 * HOLE: the corpus presents a narrow set of selectors, asserted as a set, so the sweep is what
 * covers the rest. Nothing here says what a shape byte draws, nor which records this is run on.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-323a.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { stepCraftFlightScript } from "../stepCraftFlightScript.js";
import { loc_323a as oracle } from "../../translated/loc_323a.js";
import { fetchTableByte } from "../fetchTableByte.js";
import { fetchTableWord } from "../fetchTableWord.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { assertDeadAtExit } from "./_deadAtExit.js";

const TARGET = 0x323a;

const STEP_TIMER = 9;
const RUN_SELECTOR = 10;
const SHAPE_BYTE = 8;
const RUN_POINTERS = 0x3438;

const SCRATCH_BYTES = 4;
// A BOUND, not an exact list: the flag byte and sp always move (oracle returns through the stack),
// and d/e hold the dead table pointer the stack-free rewrite leaves standing rather than swapping
// back into de — no caller reads it (the three callers exx, overwrite, or reload de first).
// c (the new count, parked for the second lookup) and h/l (where the byte lookup landed) are what
// the frozen side's register-passing leaves; the rewrite passes both as arguments and leaves
// neither. DEAD AT EXIT below shows the oracle never reads either after this routine hands back.
const EXCLUDED = ["f", "c", "d", "e", "h", "l", "sp"];
/** The registers the rewrite stopped leaving, each poisoned at the frozen exit by DEAD AT EXIT. */
const LEFT_BEHIND = ["c", "h", "l"];
const DEAD_SESSIONS = [
  { label: "coin-start", tape: undefined, frames: ENTRY_FRAMES },
  { label: "attract", tape: [], frames: 3000 },
];

const DISPATCHES = { shared: 45, attract: 31 };
const TAPES = [["shared", {}], ["attract", { tape: [] }]];

const PAINT_EITHER_SIDE = 6;
const SELECTORS = [0, 1, 7, 15];
const SWEEP_SIZE = 256 * SELECTORS.length;

/** A work-RAM run the sweep can poke, so the walk's direction is asserted on known bytes. */
const POKED_RUN = 0xafa0;
const POKED_RUN_BYTES = 8;

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

const inScratch = (addr, sp) => addr >= sp - SCRATCH_BYTES && addr < sp;

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  const moved = REG_FIELDS.find((k) => !EXCLUDED.includes(k) && a.regs[k] !== b.regs[k]);
  return moved ? { addr: null, a: a.regs[moved], b: b.regs[moved] } : null;
}

let corpusCache = null;
function corpus() {
  if (corpusCache) return corpusCache;
  corpusCache = TAPES.map(([label, opts]) => {
    const states = [];
    const selectors = new Set();
    const timers = new Set();
    const host = makeMachine(
      new Map([[TARGET, (mm) => {
        states.push(mm.clone());
        selectors.add(mm.mem8[mm.regs.ix + RUN_SELECTOR]);
        timers.add(mm.mem8[mm.regs.ix + STEP_TIMER]);
        return oracle(mm);
      }]]),
      opts,
    );
    const frames = host.runFrames(ENTRY_FRAMES);
    assert.equal(host.stoppedBy, null, `the ${label} session stopped early: ${host.stoppedBy}`);
    assert.equal(frames.length, ENTRY_FRAMES, `the ${label} session ran short`);
    assert.equal(states.length, DISPATCHES[label], `the ${label} dispatch count moved`);
    return { label, states, selectors, timers };
  });
  return corpusCache;
}

const anEntry = () => corpus()[0].states[0];

const marker = (addr) => ((addr & 0xff) ^ 0x5a) || 0x5a;

function bandCells(record) {
  const out = [];
  for (let d = -PAINT_EITHER_SIDE; d <= RUN_SELECTOR + PAINT_EITHER_SIDE; d++) out.push(record + d);
  return out;
}

/** A real captured machine with the record's band painted and its two inputs forced. */
function craft(timer, selector) {
  const m = anEntry().clone();
  const record = m.regs.ix;
  for (const a of bandCells(record)) m.mem8[a] = marker(a);
  m.mem8[record + STEP_TIMER] = timer;
  m.mem8[record + RUN_SELECTOR] = selector;
  return m;
}

function sweepCaught(candidate) {
  let caught = 0;
  for (let timer = 0; timer < 256; timer++) {
    for (const selector of SELECTORS) if (unitDiff(candidate, craft(timer, selector))) caught++;
  }
  return caught;
}

/**
 * The shape byte the ORACLE writes, with the selected run redirected into poked work RAM. The
 * table of run pointers is in the program image, so the redirect pokes the image itself and puts
 * it back afterwards; the run's own bytes are ordinary work RAM.
 */
function shapeFromPokedRun(timer, runBytes) {
  const m = craft(timer, 0);
  const record = m.regs.ix;
  const image = m.mem.rom;
  const wasLow = image[RUN_POINTERS];
  const wasHigh = image[RUN_POINTERS + 1];
  image[RUN_POINTERS] = POKED_RUN & 0xff;
  image[RUN_POINTERS + 1] = POKED_RUN >> 8;
  try {
    for (let i = 0; i < runBytes.length; i++) m.mem8[POKED_RUN + i] = runBytes[i];
    oracle(m);
    return m.mem8[record + SHAPE_BYTE];
  } finally {
    image[RUN_POINTERS] = wasLow;
    image[RUN_POINTERS + 1] = wasHigh;
  }
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CORPUS: every dispatch of two real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of corpus()) {
    assert.ok(s.states.length > 0, `vacuous: the ${s.label} tape never reached the routine`);
    for (const state of s.states) {
      const d = unitDiff(stepCraftFlightScript, state);
      assert.equal(d, null, `${s.label}: ${show(d)}`);
    }
    total += s.states.length;
  }
  console.log(`  CORPUS: ${total} real dispatches over two sessions, identical on each`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft(7, 0));
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell, not on a register");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: the ceiling registers, pc and the two lookup pushes", { skip }, () => {
  const entry = craft(7, 0);
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  stepCraftFlightScript(b);
  assert.deepEqual(REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k] && !EXCLUDED.includes(k)), [],
    "a register diverged outside the excluded set");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.deepEqual(allDiffs(a, b).filter((d) => !inScratch(d.addr, sp)), [],
    "a divergence escaped the scratch window");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")}, pc, and [SP-${SCRATCH_BYTES}, SP)`);
});

test("DEAD AT EXIT: on the frozen game, c, h and l are read by nobody once this routine hands back", { skip }, () => {
  // assertDeadAtExit runs the SP exit control at the same exit and needs it heard in some session.
  const exits = assertDeadAtExit({
    at: TARGET, poison: LEFT_BEHIND, reachEvery: true, sessions: DEAD_SESSIONS,
    // ENTRY CONTROL: the record register shifted one byte on the way IN, where it is read.
    controls: [{ label: "entry", poison: ["ix"], flip: { ix: 1 }, before: true }],
  });
  for (const r of exits) {
    assert.equal(r.dead.stopped, null, `${r.label}: the poisoned run stopped early: ${r.dead.stopped}`);
  }
});

test("THE EARLY EXIT IS REAL: a timer at zero leaves the whole dump untouched", { skip }, () => {
  const before = craft(0, 0);
  const after = before.clone();
  oracle(after);
  assert.deepEqual(allDiffs(before, after).filter((d) => !inScratch(d.addr, before.regs.sp)), [],
    "the oracle wrote something with the timer already at zero, so the early exit is not an exit");
  const d = unitDiff(brokenNoOp, before);
  assert.equal(d, null, "with the timer at zero a no-op must be indistinguishable, by construction");
  console.log("  EARLY EXIT: with the timer at zero, nothing is written by either arm");
});

test("EXHAUSTIVE: 256 timer values crossed with four selectors, on a painted record", { skip }, () => {
  assert.equal(sweepCaught(stepCraftFlightScript), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} timer x selector comparisons identical`);
});

test("THE RUN IS WALKED BACKWARDS: adjacent timers pick adjacent, DESCENDING entries", { skip }, () => {
  const runBytes = Array.from({ length: POKED_RUN_BYTES }, (_unused, i) => 0xc0 + i);
  const atFive = shapeFromPokedRun(5, runBytes);
  const atFour = shapeFromPokedRun(4, runBytes);
  assert.equal(atFive, runBytes[4], "the timer does not index the run by its value after the step");
  assert.equal(atFour, runBytes[3], "two adjacent timers do not pick two adjacent entries");
  assert.ok(atFive > atFour, "counting the timer down must walk the run toward its start");
  console.log(`  BACKWARDS: timer 5 picks entry 4 (${hex4(atFive)}), timer 4 picks entry 3 (${hex4(atFour)})`);
});

test("WHAT THE REAL DISPATCHES COVER: the selectors and timers the tapes present", { skip }, () => {
  const selectors = [...new Set(corpus().flatMap((s) => [...s.selectors]))].sort((x, y) => x - y);
  const timers = [...new Set(corpus().flatMap((s) => [...s.timers]))].sort((x, y) => x - y);
  assert.ok(selectors.length < SELECTORS.length + 4,
    "the tapes now present a wide selector set, so the sweep is no longer the load-bearing arm");
  assert.ok(timers.length > 1, "every real dispatch presents the same timer, which is suspicious");
  console.log(`  COVERAGE: real selectors {${selectors}}, ${timers.length} distinct timers`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** The shared tail: pick the run the selector names, then the entry the step names. */
function refresh(m, record, step, selector, pointers) {
  const { mem8, regs } = m;
  regs.c = step;
  regs.a = selector;
  regs.hl = pointers;
  fetchTableWord(m);
  regs.exDeHl();
  regs.a = step;
  mem8[record + SHAPE_BYTE] = fetchTableByte(m);
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: refreshes the shape but never counts the timer down, so the run never advances. */
function brokenNoDecrement(m, record = m.regs.ix) {
  const remaining = m.mem8[record + STEP_TIMER];
  if (remaining === 0) return;
  refresh(m, record, remaining - 1, m.mem8[record + RUN_SELECTOR], RUN_POINTERS);
}

/** BUG: indexes the run with the timer BEFORE the step, so the run is one entry out. */
function brokenIndexBeforeStep(m, record = m.regs.ix) {
  const remaining = m.mem8[record + STEP_TIMER];
  if (remaining === 0) return;
  m.mem8[record + STEP_TIMER] = remaining - 1;
  refresh(m, record, remaining, m.mem8[record + RUN_SELECTOR], RUN_POINTERS);
}

/** BUG: runs on with the timer at zero, wrapping it round instead of stopping. */
function brokenNoFloor(m, record = m.regs.ix) {
  const step = (m.mem8[record + STEP_TIMER] - 1) & 0xff;
  m.mem8[record + STEP_TIMER] = step;
  refresh(m, record, step, m.mem8[record + RUN_SELECTOR], RUN_POINTERS);
}

/** BUG: reads the run selector out of the byte beside it. */
function brokenSelectorOffByOne(m, record = m.regs.ix) {
  const remaining = m.mem8[record + STEP_TIMER];
  if (remaining === 0) return;
  const step = remaining - 1;
  m.mem8[record + STEP_TIMER] = step;
  refresh(m, record, step, m.mem8[record + RUN_SELECTOR + 1], RUN_POINTERS);
}

/** BUG: reads the table of run pointers one entry along. */
function brokenPointersOffByOne(m, record = m.regs.ix) {
  const remaining = m.mem8[record + STEP_TIMER];
  if (remaining === 0) return;
  const step = remaining - 1;
  m.mem8[record + STEP_TIMER] = step;
  refresh(m, record, step, m.mem8[record + RUN_SELECTOR], RUN_POINTERS + 2);
}

/** BUG: writes the shape into the byte beside the one it belongs in. */
function brokenShapeOffByOne(m, record = m.regs.ix) {
  const remaining = m.mem8[record + STEP_TIMER];
  if (remaining === 0) return;
  const step = remaining - 1;
  m.mem8[record + STEP_TIMER] = step;
  refresh(m, record - 1, step, m.mem8[record + RUN_SELECTOR], RUN_POINTERS);
}

/** BUG: counts the timer down and never refreshes the shape. */
function brokenNoRefresh(m, record = m.regs.ix) {
  const remaining = m.mem8[record + STEP_TIMER];
  if (remaining === 0) return;
  m.mem8[record + STEP_TIMER] = remaining - 1;
}

/** The 1020 is the sweep minus its four already-at-zero entries, where the early exit hides
 * every twin that only changes what the working arm does.
 *
 * Three twins read the WRONG run entry and are caught on fewer: wherever the entry they land on
 * holds the same byte as the right one, memory is identical and the
 * only trace left was the lookup's landing address in h/l — which DEAD AT EXIT shows nobody reads,
 * so it is in the ceiling and those entries are, correctly, no longer catches. The counts are
 * memory catches: unitDiff checks the dump before any register, and every register these twins
 * could still move beyond memory is in the ceiling. */
const WORKING = SWEEP_SIZE - SELECTORS.length;
const TWINS = [
  ["no-op", brokenNoOp, WORKING],
  ["no-decrement", brokenNoDecrement, WORKING],
  ["index-before-step", brokenIndexBeforeStep, 228],
  ["no-floor-at-zero", brokenNoFloor, SELECTORS.length],
  ["selector-off-by-one", brokenSelectorOffByOne, 993],
  ["pointers-off-by-one", brokenPointersOffByOne, 678],
  ["shape-off-by-one", brokenShapeOffByOne, WORKING],
  ["no-refresh", brokenNoRefresh, WORKING],
];

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${SWEEP_SIZE} crafted entries`);
  });
}

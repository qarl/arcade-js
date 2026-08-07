// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_4dde — memory-equivalent to the frozen oracle at ROM 0x4DDE.
 *
 * WHAT IT IS. A one-shot award fired when a tally's top byte matches one of a list of marks. Two
 * of the things it does are ALREADY decompiled — the ring append and the sound request it leaves
 * by — so the rewrite calls postCommand and loc_5805 directly and both dissolves belong here.
 *
 * ★ THE SEARCH IS AN EQUALITY, NOT A THRESHOLD, and that is what the crafted sweep is for. Every
 *   one of the 256 possible tally bytes is tried against both mark lists, so the arm covers the
 *   marks, the values just either side of every mark, and the whole space between them. A twin
 *   that treats a mark as a threshold is caught 1888 times by that sweep and ZERO times by either
 *   real session, which is exactly why the sweep and not the corpus is the load-bearing arm.
 *
 * GATE: strict unit-capture over every dispatch of two replayed real sessions, an exhaustive sweep
 *   of everything the entry reads, and a whole-machine replay. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — RAM identical outside the dead stack bytes, whose depth is
 *      measured by its own arm in the crafted space, since the corpus never reaches the arm that
 *      pushes deepest.
 *   2. NOT VACUOUS — a candidate that does nothing FAILS somewhere in the crafted space, and the
 *      REAL DISPATCH arm measures whether it fails at the captured entry too.
 *   3. EXCLUDED, DELIBERATELY — the union of every register that differs anywhere in the crafted
 *      sweep, asserted as a set, so "excluded" is pinned over the space rather than at one entry.
 *   4. CORPUS — every dispatch of two sessions replayed, with both counts and the arm histogram
 *      asserted; a session that stops presenting the award arm invalidates the per-twin counts.
 *   5. EXHAUSTIVE — 256 tally values x both mark lists x both tallies x both latch states.
 *   6. WHOLE-MACHINE — both sessions with the rewrite wired through the omitted-return seam.
 *   7. TEETH — eight twins, each with exact catch counts over the crafted space and each session.
 *      EVERY one is caught zero times by both real sessions, which is the corpus arm's finding
 *      restated per twin: no tape in this budget crosses a mark.
 *
 * HOLE: the real sessions run with whatever the tally happens to be, which in the corpus budget
 * never crosses a mark; the award itself is therefore reached only by crafted priors, and the
 * per-twin real counts say which twins that makes invisible.
 * HOLE: the sweep varies the tally's TOP byte, because that is the only byte the entry reads.
 * Nothing here speaks for the rest of the tally, and nothing needs to.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4dde.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { loc_4dde } from "../loc_4dde.js";
import { loc_5805 } from "../loc_5805.js";
import { postCommand } from "../postCommand.js";
import { PLAY_ACTIVE, ACTIVE_PLAYER, LIVES_REMAINING } from "../names.js";
import { loc_4dde as oracle } from "../../translated/loc_4dde.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x4dde;

const SETTING = 0xa9c3;
const MARKS_WHEN_CLEAR = 0x4e1b;
const MARKS_WHEN_SET = 0x4e30;
const FIRST_TALLY_TOP = 0xad35;
const SECOND_TALLY_TOP = 0xad38;
const LATCH = 0xad03;
const LATCH_BIT = 0x01;
const AWARD_COMMAND = 5;

/**
 * The dead window under the stack pointer. SIX bytes, not two: the award arm nests two further
 * calls, and the corpus never reaches it, so this depth is measured in the crafted space and the
 * SCRATCH DEPTH arm below asserts it there rather than taking it from the sessions.
 */
const SCRATCH_BYTES = 6;
const SCRATCH_OFFSETS = [-6, -5, -4, -3, -2, -1];
const EXCLUDED = ["a", "f", "c", "d", "e", "h", "l", "sp"];

const CORPUS_FRAMES = 2000;
const DISPATCHES = { shared: 598, attract: 879 };
const TAPES = [
  ["shared", {}],
  ["attract", { tape: [] }],
];

/**
 * The only cells a whole session leaves differing: the two at the top of the stack where the frame
 * interrupt pushes the program counter it pops again. Measured, per tape.
 */
const SESSION_SCRATCH = { shared: [0xaffd, 0xaffe], attract: [0xaffd, 0xaffe] };

const skip = romsPresent() ? false : "ROM images are not assembled";
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

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  const arms = { inactive: 0, miss: 0, alreadyFired: 0, award: 0 };
  const dirty = new Set();
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    arms[armOf(mm)]++;
    const sp = mm.regs.sp;
    const a = mm.clone();
    const b = mm.clone();
    oracle(a);
    candidate(b);
    for (const d of allDiffs(a, b)) if (inScratch(d.addr, sp)) dirty.add(d.addr - sp);
    if (unitDiff(candidate, mm)) caught++;
    return oracle(mm);
  }]]), opts);
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, arms, dirty };
}

/** Which of the four ways out a machine takes, computed from the cells the entry reads. */
function armOf(m) {
  const { mem8 } = m;
  if (mem8[PLAY_ACTIVE] === 0) return "inactive";
  const marks = (mem8[SETTING] & 1) === 0 ? MARKS_WHEN_CLEAR : MARKS_WHEN_SET;
  const reached = mem8[mem8[ACTIVE_PLAYER] === 0 ? FIRST_TALLY_TOP : SECOND_TALLY_TOP];
  let matched = false;
  for (let i = 1; i <= mem8[marks]; i++) matched ||= mem8[(marks + i) & 0xffff] === reached;
  if (!matched) return "miss";
  return (mem8[LATCH] & LATCH_BIT) !== 0 ? "alreadyFired" : "award";
}

let cache = null;
function sessions() {
  if (!cache) cache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, loc_4dde) }));
  return cache;
}

let entry = null;
function entryState() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    m.runFrames(CORPUS_FRAMES);
  }
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  return entry;
}

/** A real captured machine with everything this entry reads forced. */
function craft(tally, setting, selector, latch) {
  const m = entryState().clone();
  m.mem8[PLAY_ACTIVE] = 1;
  m.mem8[SETTING] = setting;
  m.mem8[ACTIVE_PLAYER] = selector;
  m.mem8[selector === 0 ? FIRST_TALLY_TOP : SECOND_TALLY_TOP] = tally;
  m.mem8[LATCH] = latch;
  return m;
}

const TALLIES = Array.from({ length: 256 }, (_unused, t) => t);
const SETTINGS = [0, 1];
const SELECTORS = [0, 1];
const LATCHES = [0, LATCH_BIT];
const SWEEP_SIZE = TALLIES.length * SETTINGS.length * SELECTORS.length * LATCHES.length;

function overSweep(fn) {
  for (const setting of SETTINGS) {
    for (const selector of SELECTORS) {
      for (const latch of LATCHES) {
        for (const tally of TALLIES) fn(craft(tally, setting, selector, latch));
      }
    }
  }
}

function sweepCaught(candidate) {
  let caught = 0;
  overSweep((machine) => {
    if (unitDiff(candidate, machine)) caught++;
  });
  return caught;
}

/** Every offset under the entry stack pointer that the crafted space ever dirties. */
function craftedScratchOffsets() {
  const offsets = new Set();
  overSweep((machine) => {
    const sp = machine.regs.sp;
    const a = machine.clone();
    const b = machine.clone();
    oracle(a);
    candidateOnce(b);
    for (const d of allDiffs(a, b)) if (inScratch(d.addr, sp)) offsets.add(d.addr - sp);
  });
  return [...offsets].sort((x, y) => x - y);
}

const candidateOnce = (mm) => loc_4dde(mm);

function movedRegisters(candidate) {
  const moved = new Set();
  overSweep((machine) => {
    const a = machine.clone();
    const b = machine.clone();
    oracle(a);
    candidate(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  });
  return REG_FIELDS.filter((k) => moved.has(k));
}

function wholeRunCells(candidate, opts) {
  const base = makeMachine(undefined, opts);
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let fired = 0;
  const host = makeMachine(
    new Map([[TARGET, withOmittedRet((mm) => (fired++, candidate(mm)))]]),
    opts,
  );
  let hostFrames = [];
  let threw = null;
  try {
    hostFrames = host.runFrames(CORPUS_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < baseFrames[i].length; o++) {
      if (baseFrames[i][o] !== hostFrames[i][o]) cells.add(base.stateOffsetToAddr(o));
    }
  }
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw, stopped: host.stoppedBy };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** The shape every twin varies, so each differs from the rewrite in exactly one decision. */
function award(m, marksOf, matches, latchCheck, argument, sound) {
  const { mem8 } = m;
  if (mem8[PLAY_ACTIVE] === 0) return;
  const marks = marksOf(m);
  const reached = mem8[mem8[ACTIVE_PLAYER] === 0 ? FIRST_TALLY_TOP : SECOND_TALLY_TOP];
  if (!matches(m, marks, reached)) {
    mem8[LATCH] &= ~LATCH_BIT;
    return;
  }
  if (latchCheck && (mem8[LATCH] & LATCH_BIT) !== 0) return;
  mem8[LATCH] |= LATCH_BIT;
  const before = mem8[LIVES_REMAINING];
  mem8[LIVES_REMAINING] = before + 1;
  postCommand(m, AWARD_COMMAND, argument(before));
  if (sound) loc_5805(m);
}

const chosenMarks = (m) => ((m.mem8[SETTING] & 1) === 0 ? MARKS_WHEN_CLEAR : MARKS_WHEN_SET);
const exactly = (m, marks, reached) => {
  for (let i = 1; i <= m.mem8[marks]; i++) if (m.mem8[(marks + i) & 0xffff] === reached) return true;
  return false;
};

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the settings bit is ignored, so one list of marks is used whatever it says. */
function brokenAlwaysFirstList(m) {
  award(m, () => MARKS_WHEN_CLEAR, exactly, true, (v) => v, true);
}

/** BUG: the selector is ignored, so the wrong side's tally is the one examined. */
function brokenAlwaysFirstTally(m) {
  const { mem8 } = m;
  if (mem8[PLAY_ACTIVE] === 0) return;
  const marks = chosenMarks(m);
  const reached = mem8[FIRST_TALLY_TOP];
  if (!exactly(m, marks, reached)) {
    mem8[LATCH] &= ~LATCH_BIT;
    return;
  }
  if ((mem8[LATCH] & LATCH_BIT) !== 0) return;
  mem8[LATCH] |= LATCH_BIT;
  const before = mem8[LIVES_REMAINING];
  mem8[LIVES_REMAINING] = before + 1;
  postCommand(m, AWARD_COMMAND, before);
  loc_5805(m);
}

/** BUG: a mark is treated as a threshold, so everything past it awards. */
function brokenThreshold(m) {
  const atOrPast = (mm, marks, reached) => {
    for (let i = 1; i <= mm.mem8[marks]; i++) if (reached >= mm.mem8[(marks + i) & 0xffff]) return true;
    return false;
  };
  award(m, chosenMarks, atOrPast, true, (v) => v, true);
}

/** BUG: the one-shot latch is not consulted, so a held tally awards every single frame. */
function brokenNoLatchCheck(m) {
  award(m, chosenMarks, exactly, false, (v) => v, true);
}

/** BUG: a miss leaves the latch set, so a mark can only ever be awarded once. */
function brokenNeverRearms(m) {
  const { mem8 } = m;
  if (mem8[PLAY_ACTIVE] === 0) return;
  const marks = chosenMarks(m);
  const reached = mem8[mem8[ACTIVE_PLAYER] === 0 ? FIRST_TALLY_TOP : SECOND_TALLY_TOP];
  if (!exactly(m, marks, reached)) return;
  if ((mem8[LATCH] & LATCH_BIT) !== 0) return;
  mem8[LATCH] |= LATCH_BIT;
  const before = mem8[LIVES_REMAINING];
  mem8[LIVES_REMAINING] = before + 1;
  postCommand(m, AWARD_COMMAND, before);
  loc_5805(m);
}

/** BUG: the count goes out AFTER the step rather than before it. */
function brokenPostIncrementArgument(m) {
  award(m, chosenMarks, exactly, true, (v) => v + 1, true);
}

/** BUG: the award is posted and the sound that goes with it is not. */
function brokenSilent(m) {
  award(m, chosenMarks, exactly, true, (v) => v, false);
}

const TWINS = [
  ["no-op", brokenNoOp, 1024, [0, 0]],
  ["always-first-list", brokenAlwaysFirstList, 124, [0, 0]],
  ["always-first-tally", brokenAlwaysFirstTally, 74, [0, 0]],
  ["threshold", brokenThreshold, 1888, [0, 0]],
  ["no-latch-check", brokenNoLatchCheck, 74, [0, 0]],
  ["never-rearms", brokenNeverRearms, 950, [0, 0]],
  ["post-increment-argument", brokenPostIncrementArgument, 74, [0, 0]],
  ["silent", brokenSilent, 74, [0, 0]],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: loc_4dde == oracle outside the scratch window", { skip }, () => {
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_4dde(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  console.log(`  EQUAL: the captured entry takes the ${armOf(entryState())} arm; identical`);
});

test("NOT VACUOUS: a no-op candidate FAILS in the crafted space", { skip }, () => {
  assert.ok(sweepCaught(brokenNoOp) > 0, "the diff passed a candidate that does nothing, everywhere");
  console.log(`  NOT VACUOUS: the empty candidate is caught ${sweepCaught(brokenNoOp)} times`);
});

test("EXCLUDED, deliberately: pinned over the whole crafted space, not at one entry", { skip }, () => {
  assert.deepEqual(movedRegisters(loc_4dde), EXCLUDED, "the excluded set changed shape");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc`);
});

test("CORPUS: every dispatch of two real sessions replays identically", { skip }, () => {
  for (const s of sessions()) {
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    assert.equal(
      s.arms.award,
      0,
      `the ${s.label} session now reaches the award arm, so the per-twin real counts below are ` +
        "measuring a different corpus and must be re-derived",
    );
  }
  console.log(
    "  CORPUS: " + sessions().map((s) => `${s.label} ${s.dispatches} ${JSON.stringify(s.arms)}`).join(", "),
  );
});

test("SCRATCH DEPTH: the crafted space dirties exactly six bytes under the stack pointer", { skip }, () => {
  assert.deepEqual(
    craftedScratchOffsets(),
    SCRATCH_OFFSETS,
    "the dead window changed depth, so the mask every other arm uses is the wrong size",
  );
  console.log(`  SCRATCH DEPTH: offsets ${SCRATCH_OFFSETS.join(" ")} relative to the entry pointer`);
});

test("EXHAUSTIVE: 256 tallies x two mark lists x two tallies x two latch states", { skip }, () => {
  assert.equal(sweepCaught(loc_4dde), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} crafted comparisons identical`);
});

for (const [label, opts] of TAPES) {
  test(`WHOLE-MACHINE: the ${label} session differs only in the dead stack bytes`, { skip }, () => {
    const r = wholeRunCells(loc_4dde, opts);
    assert.equal(r.threw, null, `the run threw: ${r.threw}`);
    assert.equal(r.stopped, null, `the run stopped early (${r.stopped})`);
    assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
    assert.ok(r.fired > 0, "vacuous: the override never dispatched");
    assert.deepEqual(r.cells, SESSION_SCRATCH[label], "a divergence escaped the dead stack bytes");
    console.log(`  WHOLE-MACHINE/${label}: ${r.fired} dispatches, ${r.cells.length} cells differ`);
  });
}

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught, perSession] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${SWEEP_SIZE} crafted entries`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = TAPES.map(([, opts]) => replaySession(opts, twin));
    for (const [i, r] of counts.entries()) {
      assert.equal(r.dispatches, DISPATCHES[TAPES[i][0]], "the session's dispatch count moved");
      assert.equal(r.caught, perSession[i], `the ${label} twin's ${TAPES[i][0]} catch count moved`);
    }
    console.log(`  TEETH/${label}: real sessions catch ${counts.map((r) => r.caught).join("/")}`);
  });
}

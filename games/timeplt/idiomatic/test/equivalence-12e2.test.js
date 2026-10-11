// SPDX-License-Identifier: GPL-3.0-only
/**
 * holdThenPassTurnToOtherPlayerIfLivesElseStepSequence — memory-equivalent to the frozen oracle at ROM 0x12E2.
 *
 * WHAT IT IS. Three instructions: point at the sequence delay, decrement it in place, and return
 * unless it has just reached zero. When it has, control falls through into ROM 0x12E7, WHICH IS
 * ALREADY DECOMPILED, so the rewrite calls passTurnToOtherPlayerIfLivesElseStepSequence directly and dissolving that fall-through
 * belongs to this caller's unit. The decrement wraps rather than sticking, so the cell held at
 * zero buys a full 256 frames before the next decision.
 *
 * ★ NO EXCLUSION, AND THAT IS MEASURED RATHER THAN ASSUMED. The frozen routine reaches its tail by
 *   falling through rather than by calling, and the WINDOW arm instruments the oracle's own push
 *   over the whole crafted space and finds it never goes below its seat. So the whole state dump
 *   is compared, the stack included, and there is no masked window anywhere in this file.
 *
 * ★ THE LIVE-OUT IS DERIVED FROM THE ORACLE'S EXIT SUCCESSORS, NOT FROM THE REWRITE. The oracle
 *   has two exits and neither leaves a consumer. One is its own `ret nz`. The other is the tail,
 *   which ends in ROM 0x1226 or ROM 0x0F1A, each a plain `ret` — so both arms hand back to
 *   whatever called THIS entry. Nothing calls it: the little-endian word for this address occurs
 *   in the whole 24KB image exactly once, at ROM 0x0F3F, which is arm 11 of the inline jump table
 *   that the sequence dispatcher at ROM 0x0F1F reads, and that dispatcher parks its own return
 *   address before transferring. Arms of that table leave wholly different register files from one
 *   another, so nothing downstream can be reading one. Hence memory-only — and the LIVE-OUT arm
 *   below does not stop at the reading: it forces EVERY register except the stack pointer hostile
 *   after every dispatch of a whole session and finds the machine bit-identical, with a poke at
 *   the one cell this routine writes as the positive control that the instrument can see anything
 *   at all.
 *
 * ★ THE FIRING ARM IS RARE AND THE HAND-OVER ARM IS NEVER REACHED. Real play spends almost every
 *   dispatch counting down; the delay reaches zero a handful of times per session, and on none of
 *   those does the other player have a life left, so the tail's hand-over branch is not exercised
 *   by any session here. Both facts are measured and asserted, and the two twins that only differ
 *   on the hand-over branch are recorded as caught by ZERO real dispatches and by no whole run
 *   either. The crafted cross is what holds them.
 *
 * GATE: strict unit-capture with NO exclusion, six replayed real sessions at every dispatch, a
 *   sweep that is exhaustive over this routine's own decision, and a whole-machine replay.
 *
 * The whole-machine replay needs a shim: the host engine is cycle-driven and both arms end in a
 * return the rewrite does not take, so a candidate charging no T-states would move the vblank
 * interrupt and leak two stack bytes per dispatch. The total is measured off a clone per dispatch
 * rather than predicted, which makes it exact by construction.
 *
 * HOLE: every session here reaches this entry only because one nibble is forced at the sequence
 * dispatcher. Nothing in this file says how often an untouched cabinet takes arm 11.
 * HOLE: the crafted cross varies the active-player index and the two saved life counts and nothing
 * else about the tail's world; what the tail then does with them is its own gate's business.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-12e2.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { buildRoutines } from "../../routines.js";
import { holdThenPassTurnToOtherPlayerIfLivesElseStepSequence } from "../holdThenPassTurnToOtherPlayerIfLivesElseStepSequence.js";
import { passTurnToOtherPlayerIfLivesElseStepSequence } from "../passTurnToOtherPlayerIfLivesElseStepSequence.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";
import {
  ACTIVE_PLAYER,
  PLAYER_ONE_LIVES,
  PLAYER_TWO_LIVES,
  SEQUENCE_DELAY,
  SEQUENCE_SUBSTEP,
} from "../names.js";
import { loc_12e2 as oracle } from "../../translated/loc_12e2.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8 } from "../../../../core/int.js";

const TARGET = 0x12e2;

/** Every cell the frozen routine moves, across both its arms and both branches of its tail. */
const WRITE_SET = [SEQUENCE_SUBSTEP, SEQUENCE_DELAY, ACTIVE_PLAYER];
/** The ceiling on register divergence. Containment is asserted, never equality. */
const EXCLUDED = ["a", "f", "h", "l", "sp"];

const DELAYS = 256;
/** Values of the delay cell in the cross: one that wraps, one that fires, one that does not. */
const CROSS_DELAYS = [0, 1, 2];
const FIRING_DELAY = 1;
const INDEXES = [0, 1, 2, 255];
const COUNTS = [0, 1, 3, 255];

/** The sequence dispatcher, the arm of its inline table that is this entry, and its selector. */
const SEQUENCE_DISPATCH = 0x0f1f;
const ARM = 11;
const ARM_MASK = 0x0f;

const CORPUS_FRAMES = 1200;
const WHOLE_FRAMES = 1200;
const RET_TSTATES = 10;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/** The coin-then-start tape with the stick walked round the compass, trigger held. */
function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (let i = 0; i < 60; i++) {
    tape.push({ frame, port: IN1, bits: compass[i % compass.length], dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const dispatcher = buildRoutines().get(SEQUENCE_DISPATCH);

/**
 * Any tape, with the sequence dispatcher's selector nudged onto this entry's arm and NOTHING else
 * touched. The nibble is set at the dispatch and immediately handed to the real dispatcher, so the
 * machine stays coherent; holding the same cell in the frame service instead kills the run, which
 * is why the nudge sits here.
 */
function stepped(tape) {
  return (overrides) => {
    const merged = new Map(overrides ?? []);
    const inner = merged.get(SEQUENCE_DISPATCH) ?? dispatcher;
    merged.set(SEQUENCE_DISPATCH, (mm, ...args) => {
      mm.mem8[SEQUENCE_SUBSTEP] = (mm.mem8[SEQUENCE_SUBSTEP] & ~ARM_MASK) | ARM;
      return inner(mm, ...args);
    });
    return makeMachine(merged, { tape });
  };
}

const TAPES = [["attract", []], ["shared", undefined], ["turning", turnTape()]];

/**
 * Three bare tapes and the SAME three with the selector nudged. The pairing is the instrument: a
 * zero on the left means something only because its partner on the right is not zero.
 */
const SESSIONS = [
  ...TAPES.map(([l, t]) => [l, (ov) => makeMachine(ov, { tape: t })]),
  ...TAPES.map(([l, t]) => [`stepped-${l}`, stepped(t)]),
];
const AB_PAIRS = TAPES.map(([l]) => [l, `stepped-${l}`]);

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = {
  attract: 0, shared: 0, turning: 0,
  "stepped-attract": 411, "stepped-shared": 699, "stepped-turning": 699,
};
/** Of those, how many actually take the countdown to zero. Measured. */
const FIRINGS = {
  attract: 0, shared: 0, turning: 0,
  "stepped-attract": 1, "stepped-shared": 3, "stepped-turning": 3,
};

/** The session the whole-machine and hostile-register arms run on. */
const HOST = stepped(undefined);

// ── the comparison ──────────────────────────────────────────────────────────────────────

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** The whole dump, stack included: the WINDOW arm is what says there is nothing to mask. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b)[0] ?? null;
}

/** Whether the tail would hand the turn over rather than step the sequence on. */
const handsOver = (m) =>
  m.mem8[m.mem8[ACTIVE_PLAYER] === 0 ? PLAYER_TWO_LIVES : PLAYER_ONE_LIVES] !== 0;

// ── capturing whole sessions ────────────────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    stepped([]),
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
  if (entry === null) gate(holdThenPassTurnToOtherPlayerIfLivesElseStepSequence);
  return entry;
}

function captureSession(factory) {
  let dispatches = 0;
  let firings = 0;
  let handovers = 0;
  const entries = [];
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      if (u8(mm.mem8[SEQUENCE_DELAY] - 1) === 0) {
        firings++;
        if (handsOver(mm)) handovers++;
      }
      entries.push(mm.clone());
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, firings, handovers, entries };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...captureSession(factory) }));
  }
  return sessionCache;
}
const sessionNamed = (label) => sessions().find((s) => s.label === label);
const corpusCaught = (candidate) =>
  sessions().map((s) => s.entries.filter((e) => unitDiff(candidate, e) !== null).length);

// ── the crafted space ───────────────────────────────────────────────────────────────────

/** A real captured machine with the delay and the tail's three inputs forced. */
function craft(delay, index, first, second) {
  const m = entryState().clone();
  m.mem8[SEQUENCE_DELAY] = delay;
  m.mem8[ACTIVE_PLAYER] = index;
  m.mem8[PLAYER_ONE_LIVES] = first;
  m.mem8[PLAYER_TWO_LIVES] = second;
  return m;
}

let pointCache = null;
function points() {
  if (pointCache) return pointCache;
  const e = entryState();
  const out = [];
  for (let d = 0; d < DELAYS; d++) {
    out.push(craft(d, e.mem8[ACTIVE_PLAYER], e.mem8[PLAYER_ONE_LIVES], e.mem8[PLAYER_TWO_LIVES]));
  }
  for (const index of INDEXES) {
    for (const first of COUNTS) {
      for (const second of COUNTS) {
        for (const delay of CROSS_DELAYS) out.push(craft(delay, index, first, second));
      }
    }
  }
  pointCache = out;
  return out;
}

const handOverPoints = () =>
  points().filter((p) => p.mem8[SEQUENCE_DELAY] === FIRING_DELAY && handsOver(p)).length;

/** How far below its seat the oracle's own pushes take the stack pointer, on one entry state. */
function oracleDepth(machine) {
  const c = machine.clone();
  const seat = c.regs.sp;
  let deepest = seat;
  const push = c.push16.bind(c);
  c.push16 = (v) => {
    const r = push(v);
    if (c.regs.sp < deepest) deepest = c.regs.sp;
    return r;
  };
  oracle(c);
  return seat - deepest;
}

// ── the whole-machine replay, and the hostile-register instrument ───────────────────────

let baselineRun = null;
function baseline() {
  if (!baselineRun) {
    const base = HOST();
    const frames = base.runFrames(WHOLE_FRAMES);
    assert.equal(base.stoppedBy, null, `the baseline stopped early: ${base.stoppedBy}`);
    baselineRun = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o) };
  }
  return baselineRun;
}

/** Run the host session with one override wired, and report every cell that ever differed. */
function sessionCells(override) {
  const base = baseline();
  let fired = 0;
  const host = HOST(new Map([[TARGET, (mm) => (fired++, override(mm))]]));
  let hostFrames = [];
  let threw = null;
  try {
    hostFrames = host.runFrames(WHOLE_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  let frame = -1;
  const n = Math.min(base.frames.length, hostFrames.length);
  for (let f = 0; f < n; f++) {
    const x = base.frames[f];
    const y = hostFrames[f];
    for (let o = 0; o < x.length; o++) {
      if (x[o] !== y[o]) {
        cells.add(base.offsetToAddr(o));
        if (frame < 0) frame = f;
      }
    }
  }
  return { fired, cells: cells.size, frame, frames: n, stopped: host.stoppedBy, threw };
}

/** The dispatch as the assembled game would perform it: no T-states of its own, and no return. */
function hosted(candidate) {
  return (mm) => {
    const probe = mm.clone();
    const before = probe.cycles;
    oracle(probe);
    const total = probe.cycles - before;
    candidate(mm);
    mm.tick(total - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

const replay = (candidate) => sessionCells(hosted(candidate));

/**
 * Every register but the stack pointer, forced hostile AFTER the oracle has run. The stack pointer
 * is left alone because moving it is not a claim about this routine's live-out at all — it puts
 * the machine's stack somewhere else and the run dies on an unmapped write, which measures the
 * harness rather than the contract.
 */
const HOSTILE = REG_FIELDS.filter((k) => k !== "sp");
const forceAfter = (keys) => (mm) => {
  const v = oracle(mm);
  for (const k of keys) mm.regs[k] = 0x5a;
  return v;
};

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: never spends the delay, so the decision arrives only when the cell is already spent. */
function brokenNeverDecrements(m) {
  if (m.mem8[SEQUENCE_DELAY] !== 0) return;
  passTurnToOtherPlayerIfLivesElseStepSequence(m);
}

/** BUG: counts down and never lets the decision happen. */
function brokenNeverFallsThrough(m) {
  m.mem8[SEQUENCE_DELAY] = u8(m.mem8[SEQUENCE_DELAY] - 1);
}

/** BUG: counts down and takes the decision every single frame. */
function brokenAlwaysFallsThrough(m) {
  m.mem8[SEQUENCE_DELAY] = u8(m.mem8[SEQUENCE_DELAY] - 1);
  passTurnToOtherPlayerIfLivesElseStepSequence(m);
}

/** BUG: tests the value the cell held BEFORE the decrement, so the decision is one frame late. */
function brokenTestsBeforeTheStore(m) {
  const was = m.mem8[SEQUENCE_DELAY];
  m.mem8[SEQUENCE_DELAY] = u8(was - 1);
  if (was !== 0) return;
  passTurnToOtherPlayerIfLivesElseStepSequence(m);
}

/** BUG: the countdown sticks at zero instead of wrapping, so it fires once and then every frame. */
function brokenClampsAtZero(m) {
  const remaining = m.mem8[SEQUENCE_DELAY] === 0 ? 0 : m.mem8[SEQUENCE_DELAY] - 1;
  m.mem8[SEQUENCE_DELAY] = remaining;
  if (remaining !== 0) return;
  passTurnToOtherPlayerIfLivesElseStepSequence(m);
}

/** BUG: the count runs the other way. */
function brokenCountsUp(m) {
  const remaining = u8(m.mem8[SEQUENCE_DELAY] + 1);
  m.mem8[SEQUENCE_DELAY] = remaining;
  if (remaining !== 0) return;
  passTurnToOtherPlayerIfLivesElseStepSequence(m);
}

/** BUG: spends the cell next door. */
function brokenCellNextDoor(m) {
  const remaining = u8(m.mem8[SEQUENCE_DELAY + 1] - 1);
  m.mem8[SEQUENCE_DELAY + 1] = remaining;
  if (remaining !== 0) return;
  passTurnToOtherPlayerIfLivesElseStepSequence(m);
}

/** BUG: steps the sequence on directly, skipping the choice about handing the turn over. */
function brokenSkipsTheChoice(m) {
  const remaining = u8(m.mem8[SEQUENCE_DELAY] - 1);
  m.mem8[SEQUENCE_DELAY] = remaining;
  if (remaining !== 0) return;
  advanceSequenceSubStep(m);
}

/** BUG: takes the decision first and spends the delay after, which the hand-over branch notices. */
function brokenFallsThroughFirst(m) {
  if (u8(m.mem8[SEQUENCE_DELAY] - 1) === 0) passTurnToOtherPlayerIfLivesElseStepSequence(m);
  m.mem8[SEQUENCE_DELAY] = u8(m.mem8[SEQUENCE_DELAY] - 1);
}

/**
 * label, twin, its crafted catch count, its per-session catch counts in SESSIONS order, and
 * whether the whole run forks on it. All measured. The last two twins differ only on the tail's
 * hand-over branch, which no session here reaches, so they carry zeroes and a false — the
 * blindness is recorded rather than hidden.
 */
const TWINS = [
  ["no-op", brokenNoOp, 448, [0, 0, 0, 411, 699, 699], true],
  ["never-decrements", brokenNeverDecrements, 448, [0, 0, 0, 411, 699, 699], true],
  ["never-falls-through", brokenNeverFallsThrough, 65, [0, 0, 0, 1, 3, 3], true],
  ["always-falls-through", brokenAlwaysFallsThrough, 383, [0, 0, 0, 410, 696, 696], true],
  ["tests-before-the-store", brokenTestsBeforeTheStore, 130, [0, 0, 0, 3, 6, 6], true],
  ["clamps-at-zero", brokenClampsAtZero, 65, [0, 0, 0, 2, 3, 3], true],
  ["counts-up", brokenCountsUp, 448, [0, 0, 0, 411, 699, 699], true],
  ["the-cell-next-door", brokenCellNextDoor, 448, [0, 0, 0, 411, 699, 699], true],
  ["skips-the-hand-over-choice", brokenSkipsTheChoice, 48, [0, 0, 0, 0, 0, 0], false],
  ["falls-through-first", brokenFallsThroughFirst, 48, [0, 0, 0, 0, 0, 0], false],
];

/**
 * The module's text against the tail it is supposed to CALL. The tail is identified by a name out
 * of its own body; the module must name the tail's file, call it, and NOT carry that name. The
 * positive control is the module with the call replaced by the tail's own body, which is exactly
 * the mistake the check exists to catch — so the absence below is evidence only once the same
 * predicate has been shown rejecting the thing present.
 */
const HELPER = ["passTurnToOtherPlayerIfLivesElseStepSequence", "../passTurnToOtherPlayerIfLivesElseStepSequence.js", "handPlayOverToOtherPlayer"];
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

function callsRatherThanRestates(text, [name, file, ownName]) {
  return text.includes(`from "./${file.slice(3)}"`) && text.includes(`${name}(m)`) &&
    !text.includes(ownName);
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CONTRACT: unitEquivalence at the first real dispatch, the whole dump identical", { skip }, () => {
  const r = gate(holdThenPassTurnToOtherPlayerIfLivesElseStepSequence);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  assert.equal(r.ram, null, `the dump diverged — ${show(r.ram)}`);
  const e = entryState();
  console.log(
    `  CONTRACT: entry delay ${e.mem8[SEQUENCE_DELAY]}, index ${e.mem8[ACTIVE_PLAYER]}, counts ` +
      `${e.mem8[PLAYER_ONE_LIVES]}/${e.mem8[PLAYER_TWO_LIVES]}, seat ${hex4(e.regs.sp)}`,
  );
});

test("NOT VACUOUS: a no-op fails the same diff, at a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the whole-dump diff PASSED a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op is caught on something other than a memory cell");
  console.log(`  NOT VACUOUS: the no-op is caught at ${show(d)}`);
});

test("WINDOW: the oracle never pushes, which is why the stack is compared", { skip }, () => {
  let deepest = 0;
  for (const p of points()) deepest = Math.max(deepest, oracleDepth(p));
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat`);
  assert.equal(deepest, 0, "the oracle's stack footprint moved, so the unmasked comparison every " +
    "arm below performs is now comparing dead scratch and this file needs a window");
});

test("WRITE-SET: every cell the frozen routine moves, over the crafted space", { skip }, () => {
  const written = new Set();
  for (const p of points()) {
    const a = p.clone();
    oracle(a);
    for (const d of allDiffs(a, p)) written.add(d.addr);
  }
  const measured = [...written].sort((x, y) => x - y);
  console.log(`  WRITE-SET (measured): ${measured.map(hex4).join(", ")}`);
  assert.deepEqual(measured, [...WRITE_SET].sort((x, y) => x - y), "the frozen routine's write-set " +
    "moved, so the crafted space is exercising a different routine from the one recorded here");
});

test("TAPE REACH: three bare tapes never reach this entry; the nudge turns each around", { skip }, () => {
  const seen = sessions();
  console.log(`  TAPE REACH (measured): ${seen.map((s) => `${s.label} ${s.dispatches}`).join(", ")}`);
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  for (const [bare, held] of AB_PAIRS) {
    assert.equal(sessionNamed(bare).dispatches, 0, `${bare} started reaching this entry on its own`);
    assert.ok(
      sessionNamed(held).dispatches > 0,
      `${held} reaches this entry zero times too, so the zero at ${bare} is a rig that can reach ` +
        "nothing rather than a tape that does not come here, and it proves nothing",
    );
  }
});

test("ARM REACH: the countdown fires rarely and never hands the turn over", { skip }, () => {
  const seen = sessions();
  const firings = seen.reduce((n, s) => n + s.firings, 0);
  const handovers = seen.reduce((n, s) => n + s.handovers, 0);
  const crafted = handOverPoints();
  console.log(
    `  ARM REACH (measured): ${seen.map((s) => `${s.label} ${s.firings}`).join(", ")}; ` +
      `${handovers} of ${firings} firings hand over, against ${crafted} crafted points that do`,
  );
  for (const s of seen) assert.equal(s.firings, FIRINGS[s.label], `${s.label} firing count moved`);
  assert.ok(firings > 0, "vacuous: no session ever takes the countdown to zero, so nothing here " +
    "exercises the tail at all");
  assert.equal(handovers, 0, "a real dispatch now hands the turn over, so the two twins recorded " +
    "as invisible to real play are no longer invisible and their zeroes are stale");
  assert.ok(crafted > 0, "the crafted space reaches the hand-over branch zero times too, so the " +
    "zero above is a space that cannot reach it rather than a corpus that does not, and the two " +
    "twins that only differ there are held by nothing");
});

test("CORPUS: every dispatch of every session replays identically", { skip }, () => {
  const caught = corpusCaught(holdThenPassTurnToOtherPlayerIfLivesElseStepSequence);
  const total = sessions().reduce((n, s) => n + s.dispatches, 0);
  assert.ok(total > 0, "vacuous: no session reaches the routine at all");
  assert.deepEqual(caught, SESSIONS.map(() => 0), "the rewrite diverged on a real dispatch");
  console.log(`  CORPUS: ${total} real dispatches, the whole dump identical on each`);
});

/** Which registers a candidate parts company with the oracle on, over the crafted space. */
function movedOver(candidate) {
  const moved = new Set();
  for (const p of points()) {
    const a = p.clone();
    const b = p.clone();
    oracle(a);
    candidate(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  return moved;
}

test("EXCLUDED, as a CEILING: no register outside the declared set moves", { skip }, () => {
  const moved = movedOver(holdThenPassTurnToOtherPlayerIfLivesElseStepSequence);
  // The absence is evidence only if the same measurement CAN report a register outside the
  // ceiling, so the control leaves a mark in one the contract does not cover.
  const control = movedOver((m) => {
    holdThenPassTurnToOtherPlayerIfLivesElseStepSequence(m);
    m.regs.b = u8(m.regs.b + 1);
  });
  assert.ok(REG_FIELDS.some((k) => control.has(k) && !EXCLUDED.includes(k)),
    "the measurement reports nothing outside the ceiling even for a candidate that deliberately " +
      "moves a register outside it, so a clean reading below proves nothing");
  const measured = REG_FIELDS.filter((k) => moved.has(k));
  console.log(`  EXCLUDED (measured): ${measured.join(", ")} — ceiling ${EXCLUDED.join(", ")}`);
  // EXCLUDED is a CEILING, not a set the rewrite is required to fill. deepEqual against it would
  // DEMAND the divergence and go RED on a rewrite that became register-exact.
  assert.deepEqual(measured.filter((k) => !EXCLUDED.includes(k)), [], "a register outside the " +
    "declared ceiling diverged, so the contract this file gates on no longer describes the rewrite");
});

test("EXHAUSTIVE: every delay value, and a cross over the tail's inputs", { skip }, () => {
  for (const p of points()) {
    const d = unitDiff(holdThenPassTurnToOtherPlayerIfLivesElseStepSequence, p);
    assert.equal(d, null, `delay ${p.mem8[SEQUENCE_DELAY]} index ${p.mem8[ACTIVE_PLAYER]} counts ` +
      `${p.mem8[PLAYER_ONE_LIVES]}/${p.mem8[PLAYER_TWO_LIVES]}: ${show(d)}`);
  }
  console.log(
    `  EXHAUSTIVE: ${DELAYS} delay values — this routine's whole own input — plus a cross over ` +
      `the tail's three, ${points().length} points, the whole dump identical on each`,
  );
});

test("LIVE-OUT: no register this routine leaves behind steers anything", { skip }, () => {
  const dead = sessionCells(forceAfter(HOSTILE));
  assert.equal(dead.threw, null, `the hostile run threw: ${dead.threw}`);
  assert.equal(dead.stopped, null, `a run stopped early (${dead.stopped})`);
  assert.equal(dead.frames, WHOLE_FRAMES, `compared ${dead.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(dead.fired > 0, "vacuous: the instrument never reached the routine");
  assert.equal(dead.cells, 0, "a hostile register reached game memory, so some caller CONSUMES " +
    "one and the memory-only live-out declaration is wrong");
  const control = sessionCells((mm) => {
    const v = oracle(mm);
    mm.mem8[SEQUENCE_DELAY] = u8(mm.mem8[SEQUENCE_DELAY] + 1);
    return v;
  });
  assert.ok(control.cells > 0, "nudging the one cell this routine writes changed nothing either, " +
    "so the instrument does not reach this routine and the clean reading above proves nothing");
  console.log(
    `  LIVE-OUT: ${HOSTILE.length} registers forced hostile after all ${dead.fired} dispatches, ` +
      `no trace; a one-byte nudge at the cell it writes forks ${control.cells} cells`,
  );
});

test("DISSOLVES, NOT RESTATES: the module's text, with an inlined variant as the control", () => {
  const module = read("../holdThenPassTurnToOtherPlayerIfLivesElseStepSequence.js");
  const helper = read(HELPER[1]);
  assert.ok(callsRatherThanRestates(module, HELPER), `the module does not call ${HELPER[0]}`);
  const inlined = module.replace(`${HELPER[0]}(m);`, helper);
  assert.notEqual(inlined, module, "the substitution found nothing to replace, so the control is " +
    "the same text as the subject and decides nothing");
  assert.ok(!callsRatherThanRestates(inlined, HELPER), "the check passes a module carrying the " +
    "tail's OWN body inline, so it cannot tell a call from a copy and proves nothing");
  console.log(`  DISSOLVES, NOT RESTATES: ${HELPER[0]} is called, and an inlined copy fails the same check`);
});

test("WHOLE-MACHINE: a stepped session is byte-identical with the rewrite wired", { skip }, () => {
  const w = replay(holdThenPassTurnToOtherPlayerIfLivesElseStepSequence);
  assert.equal(w.threw, null, `the replay threw: ${w.threw}`);
  assert.ok(w.fired > 0, "vacuous: the override never dispatched");
  assert.equal(w.frames, WHOLE_FRAMES, "the replay ran short of the frames asked for");
  assert.equal(w.cells, 0, `forked at frame ${w.frame} on ${w.cells} cells`);
  console.log(`  WHOLE-MACHINE: ${w.frames} frames, ${w.fired} dispatches, identical`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted points`, { skip }, () => {
    const caught = points().filter((p) => unitDiff(twin, p) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of ${points().length} crafted points`);
    assert.ok(caught > 0, `the crafted space missed the ${label} twin everywhere, so nothing in ` +
      "this file holds the rewrite against it");
    assert.equal(caught, craftedCaught, `the ${label} twin's crafted catch count moved`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = corpusCaught(twin);
    console.log(
      `  TEETH/${label}: real sessions catch ${counts.join("/")}` +
        (counts.every((n) => n === 0) ? " — BLIND to real play, as recorded" : ""),
    );
    assert.deepEqual(counts, perSession, `the ${label} twin's real catch counts moved`);
  });

  test(`TEETH: the whole machine sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const w = replay(twin);
    assert.ok(w.fired > 0, "vacuous: the twin never dispatched");
    console.log(
      `  TEETH/${label}: whole machine ${w.cells > 0 ? `forks at frame ${w.frame} on ${w.cells} cells` : "is BLIND, as recorded"}`,
    );
    assert.equal(w.cells > 0, wholeRunSees, `the whole-machine verdict on the ${label} twin changed`);
  });
}

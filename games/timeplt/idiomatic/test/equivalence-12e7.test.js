// SPDX-License-Identifier: GPL-3.0-only
/**
 * passTurnToOtherPlayerIfLivesElseStepSequence — memory-equivalent to the frozen oracle at ROM 0x12E7.
 *
 * GATE: strict unit-capture with NO exclusion — the frozen routine pushes nothing, so the whole
 *   dump including the stack is compared — plus a captured real corpus from four sessions, a
 *   sweep that is exhaustive over the routine's whole input space by decomposition, a whole-machine
 *   replay, and teeth.
 *
 *   WHERE THE LIVE-OUT COMES FROM. It is read off the frozen routine's exit successors, not off the
 *   rewrite. Both exits are tail jumps — to ROM 0x1226 and to ROM 0x0F1A — and each of those ends
 *   in a plain `ret`, so whatever they leave in the register file goes to whoever called THIS
 *   routine. This routine is itself only ever reached as a tail: ROM 0x12E2 falls into it after a
 *   `ret nz`, and ROM 0x330B ends `jp 0x12E7`. Neither of those two has any call site at all in the
 *   transcribed image, by either the mnemonic form or the `m.call` form — they are arms of an
 *   inline jump-table dispatch, which reaches an arm with `jp (hl)`. Traced with a probe on all
 *   three `jp (hl)` sites in the image, the driven session's one dispatch of THIS routine and all
 *   of its dispatches of ROM 0x330B came in through ROM 0x0B93's table and then ROM 0x0030's,
 *   nested; ROM 0x12E2 was not reached at all in that run. Arms of those tables leave wholly
 *   different register files from one another, so nothing downstream can be reading one. Hence
 *   memory-only, and the excluded register set below is a CEILING: the arm asserts no register
 *   OUTSIDE it moves, and stays green on a rewrite that becomes register-exact.
 *
 *   THE ENTRY IS SCARCE. Four sessions over six thousand frames each produce one or two dispatches
 *   apiece, and one produces none, so the crafted sweep and not the corpus is the load-bearing arm.
 *   Both counts are measured and pinned rather than described.
 *
 * What it exercises, holes stated:
 *   1. CONTRACT — the shared unit harness reaches the routine and the whole dump is identical.
 *   2. WRITE-SET — the addresses the frozen routine moves, measured across both arms.
 *   3. EQUAL at the real dispatch — the whole dump, stack included.
 *   4. NOT VACUOUS — a no-op FAILS the same diff, on a real cell.
 *   5. ARM REACH — how many dispatches each session produces and which arm each takes. The
 *      hand-over arm is reached by exactly ONE session; the same counter reporting the other arm
 *      present in every session that reaches the routine at all is the control for the others'
 *      zeros, and the undriven session's zero DISPATCHES is controlled by the three non-zero ones.
 *   6. CORPUS — every captured dispatch of four sessions.
 *   7. EXCLUDED, as a CEILING — over a cross, no register outside the declared set moves.
 *   8. INDEX SWEEP — all 256 values of the player index at a pair of counts the two arms answer
 *      differently on, so the branch is pinned for every index and not just the two seen.
 *   9. COUNT PLANE — all 65536 pairs of the two saved counts, at one index from EACH branch. With
 *      8 that is exhaustive over the whole input space.
 *  10. THE REUSED MACHINES ARE SOUND — clone-per-point whole-dump agreement on a sample.
 *  11. WHOLE-MACHINE — the two-player session with the rewrite wired, diffed every frame.
 *  12. TEETH — eight twins, each with an exact catch count over the sweep, over the real corpus and
 *      over the whole run. Several score zero on some sessions and one is caught by NO real
 *      dispatch and by no whole run either; all of those zeros are recorded rather than glossed.
 *      With one or two real dispatches per session the corpus cannot separate candidates that
 *      agree on the handful of states real play presents, which is why the sweep carries this gate.
 *
 * HOLE: the counts swept are the FIRST byte of each saved block; nothing here varies the rest of
 * either block, and nothing here establishes what else those blocks hold.
 * HOLE: the whole-machine arm runs one tape. A twin that only shows on a state that tape never
 * reaches is held by the sweep arms alone.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-12e7.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, romsPresent } from "./_harness.js";
import { passTurnToOtherPlayerIfLivesElseStepSequence } from "../passTurnToOtherPlayerIfLivesElseStepSequence.js";
import { loc_12e7 as oracle } from "../../translated/loc_12e7.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x12e7;
const skip = romsPresent() ? false : "ROM images are gitignored and absent";

const ACTIVE_PLAYER = 0xad32;
const PLAYER_ONE_LIVES = 0xad10;
const PLAYER_TWO_LIVES = 0xad20;
const SEQUENCE_DELAY = 0xa9eb;
const SEQUENCE_SUBSTEP = 0xa9ac;

/** Everything the frozen routine writes, so the sweep can put a machine back as it found it. */
const WRITTEN = [ACTIVE_PLAYER, SEQUENCE_DELAY, SEQUENCE_SUBSTEP];
/** The inputs, which the sweep also restores. */
const INPUTS = [ACTIVE_PLAYER, PLAYER_ONE_LIVES, PLAYER_TWO_LIVES];

/** A count pair the two branches answer differently on: only the SECOND block is stocked. */
const SPLIT_ONE = 0;
const SPLIT_TWO = 1;
const INDEX_FIRST = 0;
const INDEX_SECOND = 1;

const INDEXES = 256;
const PLANE = 256 * 256;
const CROSS_CHECK_POINTS = 400;

/** Derived from the frozen routine's exit successors, not from the rewrite. See the header. */
const EXCLUDED = ["a", "f", "h", "l", "sp"];

const CORPUS_FRAMES = 6000;
const WHOLE_FRAMES = 5400;
const REACH_FRAMES = 2600;
const RET_TSTATES = 10;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;
const SECOND_COIN = 40;

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: frozen=${d.a} candidate=${d.b}` : "identical");

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

/** Two credits and the two-player start, which is the only tape that reaches the hand-over arm. */
const TWO_PLAYER_TAPE = [
  { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
  { frame: COIN_FRAME + SECOND_COIN, port: IN0, bits: 0x01, dur: HOLD },
  { frame: START_FRAME, port: IN0, bits: 0x10, dur: HOLD },
];

const sharedMachine = (overrides) => makeMachine(overrides);
const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });
const turningMachine = (overrides) => makeMachine(overrides, { tape: turnTape() });
const twoPlayerMachine = (overrides) => makeMachine(overrides, { tape: TWO_PLAYER_TAPE });

const SESSIONS = [
  ["shared", sharedMachine],
  ["attract", attractMachine],
  ["turning", turningMachine],
  ["twoplayer", twoPlayerMachine],
];

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { shared: 1, attract: 0, turning: 1, twoplayer: 2 };
/** Which arm those dispatches take, per session. Measured. */
const HANDOVERS = { shared: 0, attract: 0, turning: 0, twoplayer: 1 };
const ADVANCES = { shared: 1, attract: 0, turning: 1, twoplayer: 1 };

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

/** The whole dump, stack included. Clone per point. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b)[0] ?? null;
}

const handsOver = (m) =>
  m.mem8[m.mem8[ACTIVE_PLAYER] === INDEX_FIRST ? PLAYER_TWO_LIVES : PLAYER_ONE_LIVES] !== 0;

// ── capturing real dispatches ───────────────────────────────────────────────────────────

function captureSession(factory) {
  let dispatches = 0;
  let handovers = 0;
  const entries = [];
  const indexes = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      indexes.add(mm.mem8[ACTIVE_PLAYER]);
      if (handsOver(mm)) handovers++;
      entries.push(mm.clone());
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, handovers, entries, indexes };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...captureSession(factory) }));
  }
  return sessionCache;
}

const entryState = () => sessions()[0].entries[0];

function corpusCaught(candidate) {
  return sessions().map((s) => s.entries.filter((e) => unitDiff(candidate, e) !== null).length);
}

// ── the sweep, on two reused machines ───────────────────────────────────────────────────

let arena = null;
function pair() {
  if (!arena) arena = [entryState().clone(), entryState().clone()];
  return arena;
}

/**
 * Put a machine back exactly as the captured entry left it, then seat one point on it. Restoring
 * the three written cells alongside the three inputs is what makes reuse equivalent to cloning;
 * the WRITE-SET arm is what says those are all the frozen routine moves.
 */
function seat(m, index, first, second) {
  const seed = entryState();
  m.regs.copyFrom(seed.regs);
  for (const addr of [...WRITTEN, ...INPUTS]) m.mem8[addr] = seed.mem8[addr];
  m.mem8[ACTIVE_PLAYER] = index;
  m.mem8[PLAYER_ONE_LIVES] = first;
  m.mem8[PLAYER_TWO_LIVES] = second;
}

/**
 * One point. The comparison here is the three written cells rather than the whole dump, which is
 * what keeps a 131328-point sweep affordable; the clone-per-point arm and the captured corpus are
 * where the whole dump is walked, and the hole that leaves is stated in the header.
 */
function pointDiffers(candidate, index, first, second) {
  const [a, b] = pair();
  seat(a, index, first, second);
  seat(b, index, first, second);
  oracle(a);
  candidate(b);
  return WRITTEN.some((addr) => a.mem8[addr] !== b.mem8[addr]);
}

function indexSweepCaught(candidate) {
  let caught = 0;
  for (let i = 0; i < INDEXES; i++) {
    if (pointDiffers(candidate, i, SPLIT_ONE, SPLIT_TWO)) caught++;
  }
  return caught;
}

function planeCaught(candidate, index) {
  let caught = 0;
  for (let first = 0; first < 256; first++) {
    for (let second = 0; second < 256; second++) {
      if (pointDiffers(candidate, index, first, second)) caught++;
    }
  }
  return caught;
}

const sweepCaught = (candidate) =>
  indexSweepCaught(candidate) + planeCaught(candidate, INDEX_FIRST) + planeCaught(candidate, INDEX_SECOND);

// ── the whole-machine replay ────────────────────────────────────────────────────────────

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

let baselineRun = null;
function baseline() {
  if (!baselineRun) {
    const base = twoPlayerMachine();
    const frames = base.runFrames(WHOLE_FRAMES);
    baselineRun = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o) };
  }
  return baselineRun;
}

function wholeRunCells(candidate) {
  const base = baseline();
  let fired = 0;
  const host = twoPlayerMachine(new Map([[TARGET, (mm) => (fired++, hosted(candidate)(mm))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(WHOLE_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(base.frames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = base.frames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) cells.add(base.offsetToAddr(o));
  }
  const live = liveStackDiffs(base.frames, hostFrames, floors, (o) => base.offsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((p, q) => p - q), frames: n, fired, threw };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

const HANDOVER_DELAY = 90;
const SUBSTEP_SOURCE = 0x4b52;

function handOver(m) {
  const { mem8 } = m;
  mem8[ACTIVE_PLAYER] = (mem8[ACTIVE_PLAYER] + 1) & 1;
  mem8[SEQUENCE_DELAY] = HANDOVER_DELAY;
  mem8[SEQUENCE_SUBSTEP] = mem8[SUBSTEP_SOURCE];
}

function advance(m) {
  m.mem8[SEQUENCE_SUBSTEP] = m.mem8[SEQUENCE_SUBSTEP] + 1;
}

const otherBlock = (m) =>
  m.mem8[ACTIVE_PLAYER] === INDEX_FIRST ? PLAYER_TWO_LIVES : PLAYER_ONE_LIVES;
const ownBlock = (m) =>
  m.mem8[ACTIVE_PLAYER] === INDEX_FIRST ? PLAYER_ONE_LIVES : PLAYER_TWO_LIVES;

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the turn passes when the other player is OUT rather than when they are still in. */
function brokenInvertedCondition(m) {
  if (m.mem8[otherBlock(m)] === 0) return handOver(m);
  advance(m);
}

/** BUG: the count consulted is the ACTIVE player's own. */
function brokenReadsOwnBlock(m) {
  if (m.mem8[ownBlock(m)] !== 0) return handOver(m);
  advance(m);
}

/** BUG: the index is taken as a bit rather than tested against zero. */
function brokenBitTestedIndex(m) {
  const block = (m.mem8[ACTIVE_PLAYER] & 1) === 0 ? PLAYER_TWO_LIVES : PLAYER_ONE_LIVES;
  if (m.mem8[block] !== 0) return handOver(m);
  advance(m);
}

/** BUG: the turn always passes. */
function brokenAlwaysHandsOver(m) {
  handOver(m);
}

/** BUG: the turn never passes. */
function brokenAlwaysAdvances(m) {
  advance(m);
}

/** BUG: the byte consulted is one past the head of the block. */
function brokenReadsTheNextByte(m) {
  if (m.mem8[otherBlock(m) + 1] !== 0) return handOver(m);
  advance(m);
}

/** BUG: the sequence steps on as well as handing the turn over. */
function brokenDoesBoth(m) {
  if (m.mem8[otherBlock(m)] !== 0) {
    handOver(m);
    advance(m);
    return;
  }
  advance(m);
}

const TWINS = [
  ["no-op", brokenNoOp, 131328, [1, 0, 1, 2], true],
  ["inverted-condition", brokenInvertedCondition, 131328, [1, 0, 1, 2], true],
  ["reads-own-block", brokenReadsOwnBlock, 1276, [0, 0, 0, 1], true],
  ["bit-tested-index", brokenBitTestedIndex, 127, [0, 0, 0, 0], false],
  ["always-hands-over", brokenAlwaysHandsOver, 767, [1, 0, 1, 1], true],
  ["always-advances", brokenAlwaysAdvances, 130561, [0, 0, 0, 1], true],
  ["reads-the-next-byte", brokenReadsTheNextByte, 767, [1, 0, 1, 1], true],
  ["does-both", brokenDoesBoth, 130561, [0, 0, 0, 1], true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CONTRACT: the shared unit harness reaches the routine and the dump is identical", { skip }, () => {
  const r = unitEquivalence(sharedMachine, TARGET, oracle, passTurnToOtherPlayerIfLivesElseStepSequence, { maxFrames: REACH_FRAMES });
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  console.log(`  CONTRACT: reached within ${REACH_FRAMES} frames; the whole dump is identical`);
});

test("WRITE-SET: what the frozen routine moves, across both arms", { skip }, () => {
  const cells = new Set();
  const seed = entryState();
  for (const index of [INDEX_FIRST, INDEX_SECOND, 2, 255]) {
    for (const first of [0, 1, 3, 255]) {
      for (const second of [0, 1, 3, 255]) {
        const before = seed.clone();
        before.mem8[ACTIVE_PLAYER] = index;
        before.mem8[PLAYER_ONE_LIVES] = first;
        before.mem8[PLAYER_TWO_LIVES] = second;
        const after = before.clone();
        oracle(after);
        for (const d of allDiffs(before, after)) cells.add(d.addr);
      }
    }
  }
  const moved = [...cells].sort((p, q) => p - q);
  console.log(`  WRITE-SET (measured): [${moved.map(hex4).join(" ")}]`);
  const strays = moved.filter((a) => !WRITTEN.includes(a));
  assert.deepEqual(strays.map(hex4), [], "the frozen routine writes a cell this file does not " +
    "restore between sweep points, so the sweep's machine reuse is unsound");
  assert.ok(moved.length > 0, "vacuous: the frozen routine moved no cell at all");
});

test("EQUAL at the real dispatch: the whole dump, stack included", { skip }, () => {
  const e = entryState();
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  passTurnToOtherPlayerIfLivesElseStepSequence(b);
  assert.deepEqual(allDiffs(a, b), [], `a byte diverged — ${show(allDiffs(a, b)[0])}`);
  console.log(
    `  EQUAL: index ${e.mem8[ACTIVE_PLAYER]} counts ${e.mem8[PLAYER_ONE_LIVES]}/` +
      `${e.mem8[PLAYER_TWO_LIVES]} arriving with ${hex4(e.regs.hl)} held, sp ${hex4(e.regs.sp)}`,
  );
});

test("NOT VACUOUS: a no-op FAILS the same diff, on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the diff passed a candidate that does nothing");
  assert.ok(WRITTEN.includes(d.addr), `the no-op is caught at ${hex4(d.addr)}, not a written cell`);
  console.log(`  NOT VACUOUS: the no-op is caught at ${hex4(d.addr)}`);
});

test("ARM REACH: how scarce this entry is, and which arm each session takes", { skip }, () => {
  const seen = sessions();
  console.log(
    `  ARM REACH (measured over ${CORPUS_FRAMES} frames each): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches, ${s.handovers} hand-over`).join("; ")}`,
  );
  for (const s of seen) {
    assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} dispatch count moved`);
    assert.equal(s.handovers, HANDOVERS[s.label], `${s.label} hand-over count moved`);
    assert.equal(s.dispatches - s.handovers, ADVANCES[s.label], `${s.label} advance count moved`);
  }
  // POSITIVE CONTROLS. The undriven session's zero dispatches means something only because the
  // same override, in the same run loop, counted dispatches in the other three; and the zero
  // hand-overs elsewhere mean something only because the same arm test found one under the
  // two-player tape.
  const reaching = seen.filter((s) => s.dispatches > 0);
  assert.ok(reaching.length >= 3, "too few sessions reach the routine for the undriven zero to " +
    "be evidence of anything");
  assert.ok(seen.some((s) => s.handovers > 0), "no session reaches the hand-over arm, so the " +
    "zeros recorded for the others are uninformative");
});

test("CORPUS: every captured dispatch of four sessions is identical", { skip }, () => {
  const caught = corpusCaught(passTurnToOtherPlayerIfLivesElseStepSequence);
  const captured = sessions().map((s) => s.entries.length);
  console.log(`  CORPUS: ${captured.join("/")} captured dispatches, the whole dump identical`);
  assert.deepEqual(caught, [0, 0, 0, 0], "the rewrite diverged on a real dispatch");
  assert.ok(captured.reduce((n, c) => n + c, 0) > 0, "vacuous: nothing was captured");
});

test("EXCLUDED, as a CEILING: no register outside the declared set moves", { skip }, () => {
  const moved = new Set();
  let points = 0;
  for (const index of [0, 1, 2, 128, 255]) {
    for (const first of [0, 1, 2, 255]) {
      for (const second of [0, 1, 2, 255]) {
        const a = entryState().clone();
        a.mem8[ACTIVE_PLAYER] = index;
        a.mem8[PLAYER_ONE_LIVES] = first;
        a.mem8[PLAYER_TWO_LIVES] = second;
        const b = a.clone();
        oracle(a);
        passTurnToOtherPlayerIfLivesElseStepSequence(b);
        for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
        points++;
      }
    }
  }
  const strays = REG_FIELDS.filter((k) => moved.has(k) && !EXCLUDED.includes(k));
  console.log(
    `  EXCLUDED (measured over ${points} points): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}` +
      `; ceiling ${EXCLUDED.join(", ")}`,
  );
  assert.deepEqual(strays, [], "a register outside the declared ceiling diverged");
});

test("INDEX SWEEP: all 256 player-index values choose the same branch", { skip }, () => {
  const a = entryState().clone();
  a.mem8[ACTIVE_PLAYER] = INDEX_FIRST;
  a.mem8[PLAYER_ONE_LIVES] = SPLIT_ONE;
  a.mem8[PLAYER_TWO_LIVES] = SPLIT_TWO;
  const b = a.clone();
  b.mem8[ACTIVE_PLAYER] = INDEX_SECOND;
  assert.notEqual(handsOver(a), handsOver(b), "the sweep's count pair no longer separates the two " +
    "branches, so this arm proves nothing");
  assert.equal(indexSweepCaught(passTurnToOtherPlayerIfLivesElseStepSequence), 0, "the rewrite chose a different branch somewhere");
  console.log(`  INDEX SWEEP: ${INDEXES} indexes, on a count pair the two branches disagree about`);
});

test("COUNT PLANE: all 65536 count pairs, at one index from EACH branch", { skip }, () => {
  for (const index of [INDEX_FIRST, INDEX_SECOND]) {
    assert.equal(planeCaught(passTurnToOtherPlayerIfLivesElseStepSequence, index), 0, `diverged somewhere at index ${index}`);
  }
  console.log(`  COUNT PLANE: ${2 * PLANE} pairs across both branches, the written cells identical`);
});

test("THE REUSED MACHINES ARE SOUND: clone-per-point agrees on a sample", { skip }, () => {
  for (let i = 0; i < CROSS_CHECK_POINTS; i++) {
    const index = (i * 29) & 0xff;
    const first = (i * 37) & 0xff;
    const second = (i * 53) & 0xff;
    const m = entryState().clone();
    m.mem8[ACTIVE_PLAYER] = index;
    m.mem8[PLAYER_ONE_LIVES] = first;
    m.mem8[PLAYER_TWO_LIVES] = second;
    assert.equal(unitDiff(passTurnToOtherPlayerIfLivesElseStepSequence, m), null, `clone-per-point diverged at ${index},${first},${second}`);
    assert.equal(
      pointDiffers(passTurnToOtherPlayerIfLivesElseStepSequence, index, first, second),
      false,
      `the reused arena disagrees with clone-per-point at ${index},${first},${second}`,
    );
  }
  console.log(`  SOUND: ${CROSS_CHECK_POINTS} points agree between the arena and clone-per-point`);
});

test("WHOLE-MACHINE: the two-player session is byte-identical with the rewrite wired", { skip }, () => {
  const r = wholeRunCells(passTurnToOtherPlayerIfLivesElseStepSequence);
  console.log(
    `  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, differing cells ` +
      `[${r.cells.map(hex4).join(" ")}]`,
  );
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.frames, WHOLE_FRAMES, `compared ${r.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  assert.deepEqual(r.cells, [], "the rewrite moved a cell over a whole run");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, sweep, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of sweep points`, { skip }, () => {
    const caught = sweepCaught(twin);
    console.log(`  TEETH/${label}: caught on ${caught} of ${INDEXES + 2 * PLANE} sweep points`);
    assert.equal(caught, sweep, `the ${label} twin's sweep catch count moved`);
    assert.ok(caught > 0, `the sweep missed the ${label} twin everywhere`);
  });

  test(`TEETH: the ${label} twin's real-dispatch catch count, zeros recorded`, { skip }, () => {
    const caught = corpusCaught(twin);
    const blind = caught.every((n) => n === 0);
    console.log(
      `  TEETH/${label}: real sessions catch ${caught.join("/")}` +
        (blind ? " — caught by NO real dispatch, as recorded" : ""),
    );
    assert.deepEqual(caught, perSession, `the ${label} twin's real-dispatch counts moved`);
  });

  test(`TEETH: the whole machine sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRunCells(twin);
    const seen = r.threw !== null || r.cells.length > 0;
    console.log(`  TEETH/${label}: whole run ${seen ? "catches it" : "is BLIND, as recorded"}`);
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.equal(seen, wholeRunSees, `the whole-machine verdict on the ${label} twin changed`);
  });
}

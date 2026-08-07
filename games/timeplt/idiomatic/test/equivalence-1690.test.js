// SPDX-License-Identifier: GPL-3.0-only
/**
 * startGameOnFreePlay — memory-equivalent to the frozen oracle at ROM 0x1690.
 *
 * GATE: crafted-entry with NO exclusion at all — the frozen routine pushes nothing, so the whole
 *   state dump compares byte-identical. The strict gate CANNOT run here: neither the shared
 *   coin -> start tape nor an undriven session dispatches 0x1690 in two thousand frames, and the
 *   first arm ASSERTS that throw rather than working around it. THE GAME STILL STARTS on the
 *   driven tape, which the same arm measures — the play flag goes non-zero without this routine
 *   ever running — so this is a start path the shipped tape does not take, not dead code with no
 *   equivalent.
 *
 * What it exercises, holes stated:
 *   1. UNREACHED, and the game starts anyway — both measured.
 *   2. NOT VACUOUS — an empty candidate FAILS the crafted comparison.
 *   3. EXCLUDED — the register divergence pinned to a measured set.
 *   4. EXHAUSTIVE — the routine reads two cells, and the sweep covers the WHOLE of that space:
 *      every one of 256 panel bytes against three allowances. All three arms are reached, and
 *      the arm the sweep proves is the interesting one — a panel with BOTH start bits held,
 *      where the two-player arm must win outright.
 *   5. BOTH ARMS DO SOMETHING — asserted from a poisoned set of the four written cells, so no
 *      crafted point can pass by agreeing on an unwritten cell.
 *   6. TEETH — seven twins, each caught on an exact count of crafted entries. Not one is caught
 *      on all 768, and the shortfalls are the routine's shape: 192 of the panels hold neither
 *      start bit, so every twin that only gets a STARTED game wrong is silent on those.
 *
 * HOLE: one backdrop. Every cell but the two read ones is what the session left; the routine
 * reads nothing else, but it hands over to a phase entry that writes two more cells, and their
 * priors come from that backdrop rather than being swept.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-1690.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { startGameOnFreePlay } from "../startGameOnFreePlay.js";
import { loc_172a } from "../loc_172a.js";
import { IN0_MIRROR, PLAY_ACTIVE, SEQUENCE_PHASE, SEQUENCE_SUBSTEP, PLAYER_ONE_LIVES, PLAYER_TWO_LIVES } from "../names.js";
import { loc_1690 as oracle } from "../../translated/loc_1690.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x1690;
const skip = romsPresent() ? false : "ROM images are gitignored and absent";

const TWO_PLAYER_GAME = 0xad31;
const LIVES_PER_GAME = 0xa9c1;
const START_TWO_PLAYER = 0x10;
const START_ONE_PLAYER = 0x08;
const SET = 0xff;

const CORPUS_FRAMES = 2000;
const SESSIONS = 2;
const EXCLUDED = ["a", "f", "sp"];

const ALLOWANCES = [0, 3, 0xff];
/** A poison the correct answer never leaves in any of the four cells this routine writes. */
const POISON = 0xa5;
/** A panel with BOTH start bits held: the point where the two-player arm has to win. */
const BOTH_HELD = START_TWO_PLAYER | START_ONE_PLAYER;
const LIVE_POINT = [BOTH_HELD, 3];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: frozen=${d.a} candidate=${d.b}` : "identical");

// ── the session, and the entry built off it ─────────────────────────────────────────────

let session = null;
function sessionRun() {
  if (session) return session;
  let host = null;
  let threw = null;
  try {
    unitEquivalence((overrides) => (host = makeMachine(overrides)), TARGET, oracle, startGameOnFreePlay, {
      maxFrames: ENTRY_FRAMES,
    });
  } catch (e) {
    threw = e;
  }
  session = { host, threw };
  return session;
}

let pristineEntry = null;
function pristine() {
  if (!pristineEntry) pristineEntry = sessionRun().host.clone();
  return pristineEntry;
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

function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b)[0] ?? null;
}

const WRITTEN = [PLAY_ACTIVE, TWO_PLAYER_GAME, PLAYER_ONE_LIVES, PLAYER_TWO_LIVES];

function craft([panel, allowance]) {
  const m = pristine().clone();
  m.mem8[IN0_MIRROR] = panel;
  m.mem8[LIVES_PER_GAME] = allowance;
  for (const cell of WRITTEN) m.mem8[cell] = POISON;
  return m;
}

const POINTS = [];
for (let panel = 0; panel < 256; panel++) {
  for (const allowance of ALLOWANCES) POINTS.push([panel, allowance]);
}

function sweepCaught(candidate) {
  let caught = 0;
  for (const spec of POINTS) if (unitDiff(candidate, craft(spec))) caught++;
  return caught;
}

function dispatchCount(opts) {
  let dispatches = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => (dispatches++, oracle(mm))]]), opts);
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, playing: m.mem8[PLAY_ACTIVE] };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

function start(m, {
  oneWins = false, stockSecond = true, raiseFlag = true, handOver = true, allowance = null,
} = {}) {
  const { mem8 } = m;
  const panel = mem8[IN0_MIRROR];
  if ((panel & BOTH_HELD) === 0) return;
  const twoPlayer = oneWins
    ? (panel & START_ONE_PLAYER) === 0
    : (panel & START_TWO_PLAYER) !== 0;
  const stock = allowance === null ? mem8[LIVES_PER_GAME] : allowance;
  if (raiseFlag) mem8[PLAY_ACTIVE] = SET;
  mem8[TWO_PLAYER_GAME] = twoPlayer ? SET : 0;
  mem8[PLAYER_ONE_LIVES] = stock;
  if (stockSecond) mem8[PLAYER_TWO_LIVES] = twoPlayer ? stock : 0;
  if (handOver) loc_172a(m);
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the one-player bit is tested first, so it wins when both are held. */
function brokenOnePlayerWins(m) {
  start(m, { oneWins: true });
}

/** BUG: the second player's stock is never touched, either way. */
function brokenLeavesTheSecondPlayer(m) {
  start(m, { stockSecond: false });
}

/** BUG: the play flag is never raised, so the game never leaves attract. */
function brokenNeverRaisesTheFlag(m) {
  start(m, { raiseFlag: false });
}

/** BUG: the allowance is a constant here rather than read from the cell that holds it. */
function brokenHardCodesTheAllowance(m) {
  start(m, { allowance: 3 });
}

/** BUG: everything is stocked and nothing hands over, so the round engine never starts. */
function brokenNeverHandsOver(m) {
  start(m, { handOver: false });
}

/** BUG: a panel with neither start bit still starts a game. */
function brokenStartsOnAnything(m) {
  const { mem8 } = m;
  const twoPlayer = (mem8[IN0_MIRROR] & START_TWO_PLAYER) !== 0;
  const stock = mem8[LIVES_PER_GAME];
  mem8[PLAY_ACTIVE] = SET;
  mem8[TWO_PLAYER_GAME] = twoPlayer ? SET : 0;
  mem8[PLAYER_ONE_LIVES] = stock;
  mem8[PLAYER_TWO_LIVES] = twoPlayer ? stock : 0;
  loc_172a(m);
}

const TWINS = [
  ["no-op", brokenNoOp, 576],
  ["one-player-wins", brokenOnePlayerWins, 192],
  ["leaves-the-second-player", brokenLeavesTheSecondPlayer, 576],
  ["never-raises-the-flag", brokenNeverRaisesTheFlag, 576],
  ["hard-codes-the-allowance", brokenHardCodesTheAllowance, 384],
  ["never-hands-over", brokenNeverHandsOver, 576],
  ["starts-on-anything", brokenStartsOnAnything, 192],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED, yet the game still starts: both measured", { skip }, () => {
  assert.notEqual(sessionRun().threw, null, "the shared tape now reaches this routine, so the " +
    "strict unit-capture gate is available and this file should use it");
  assert.match(String(sessionRun().threw), /never entered/, "the harness failed for another reason");
  const driven = dispatchCount({});
  const undriven = dispatchCount({ tape: [] });
  assert.equal(driven.dispatches, 0, "the driven session now dispatches this routine");
  assert.equal(undriven.dispatches, 0, "the undriven session now dispatches this routine");
  assert.notEqual(driven.playing, 0, "the driven session no longer starts a game at all, so the " +
    "claim that some OTHER start path took it is no longer supported");
  assert.equal(undriven.playing, 0, "the undriven session started a game");
  console.log(
    `  UNREACHED: 0 dispatches over ${SESSIONS} sessions of ${CORPUS_FRAMES} frames, yet the ` +
      `driven one ends with the play flag at ${driven.playing} — another start path took it`,
  );
});

test("NOT VACUOUS: a candidate that does nothing FAILS the crafted comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft(LIVE_POINT));
  assert.notEqual(d, null, "the comparison passed an empty candidate, so it measures nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: registers and pc, and nothing else", { skip }, () => {
  const a = craft(LIVE_POINT);
  const b = a.clone();
  oracle(a);
  startGameOnFreePlay(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    EXCLUDED,
    "the excluded set changed shape",
  );
  assert.notEqual(a.pc, b.pc, "the frozen routine's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc`);
});

test("EXHAUSTIVE: every panel byte against three allowances", { skip }, () => {
  assert.equal(sweepCaught(startGameOnFreePlay), 0, "the rewrite diverged somewhere in the crafted space");
  const arms = { none: 0, one: 0, two: 0 };
  for (const [panel] of POINTS) {
    if ((panel & START_TWO_PLAYER) !== 0) arms.two++;
    else if ((panel & START_ONE_PLAYER) !== 0) arms.one++;
    else arms.none++;
  }
  assert.ok(arms.none > 0 && arms.one > 0 && arms.two > 0, "the sweep no longer reaches all three arms");
  console.log(
    `  EXHAUSTIVE: ${POINTS.length} crafted entries identical — ${arms.two} two-player, ` +
      `${arms.one} one-player, ${arms.none} doing nothing`,
  );
});

test("BOTH ARMS DO SOMETHING, and the two-player one wins when both bits are held", { skip }, () => {
  const two = craft([BOTH_HELD, 3]);
  startGameOnFreePlay(two);
  assert.equal(two.mem8[PLAY_ACTIVE], SET, "the two-player arm did not raise the play flag");
  assert.equal(two.mem8[TWO_PLAYER_GAME], SET, "the one-player bit won when both were held");
  assert.equal(two.mem8[PLAYER_TWO_LIVES], 3, "the second player was not stocked");

  const one = craft([START_ONE_PLAYER, 3]);
  startGameOnFreePlay(one);
  assert.equal(one.mem8[TWO_PLAYER_GAME], 0, "the one-player arm left the two-player flag set");
  assert.equal(one.mem8[PLAYER_TWO_LIVES], 0, "the one-player arm left the second player stocked");
  assert.equal(one.mem8[PLAYER_ONE_LIVES], 3, "the first player was not stocked");

  const neither = craft([0, 3]);
  startGameOnFreePlay(neither);
  assert.equal(neither.mem8[PLAY_ACTIVE], POISON, "a panel with neither bit still started a game");

  assert.equal(two.mem8[SEQUENCE_PHASE], one.mem8[SEQUENCE_PHASE], "the two arms hand over to " +
    "different phases, so one of them is not the entry this file describes");
  assert.equal(two.mem8[SEQUENCE_SUBSTEP], 0, "the inner index was not restarted");
  console.log(
    `  ARMS: two-player leaves ${two.mem8[TWO_PLAYER_GAME]}/${two.mem8[PLAYER_TWO_LIVES]}, ` +
      `one-player ${one.mem8[TWO_PLAYER_GAME]}/${one.mem8[PLAYER_TWO_LIVES]}, neither untouched`,
  );
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `the ${label} twin's catch count moved`);
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${POINTS.length} crafted entries`);
  });
}

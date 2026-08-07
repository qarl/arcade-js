// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1253 — memory-equivalent to the frozen oracle at ROM 0x1253.
 *
 * GATE: crafted-entry, because the strict one CANNOT run here. Neither the shared coin -> start
 *   tape nor an undriven session dispatches 0x1253 in two thousand frames — its one caller DOES
 *   run, and takes the other side of its branch every time, which this file measures — so
 *   unitEquivalence throws "never entered" and the first arm ASSERTS that throw. The entry is
 *   BUILT instead: a real machine, cloned at the end of the tape's session, with the cells the
 *   two arms read forced.
 *
 *   ONE EXCLUSION, the dead stack scratch: both arms transfer out through calls that push, so up
 *   to four bytes below the entry stack pointer can hold return slots the rewrite never writes.
 *   The window is exactly [SP-4, SP) and every arm PINS it.
 *
 * What it exercises, holes stated:
 *   1. UNREACHED — measured, together with the branch its live caller takes instead.
 *   2. NOT VACUOUS — an empty candidate FAILS on BOTH arms, not just one, because the two arms
 *      share no store at all and a gate that only exercised one would say nothing about the other.
 *   3. EXCLUDED — the register divergence pinned to a measured set, checked on both arms.
 *   4. CRAFTED — the whole cross product of the two flags this routine reads against the ring
 *      state its queueing depends on: a free cell and an occupied one, and cursors at the head,
 *      the middle and the last slot, where the ring wraps.
 *   5. THE FOLD NETS TO NOTHING — the teardown arm writes the inner index twice, once as a plain
 *      zero and once as arithmetic over two bytes of the program image. That the two agree is a
 *      property of THIS image, so it is measured here rather than assumed, and the assertion says
 *      which of the two it is checking.
 *   6. TEETH — eight twins, each caught on an exact count of crafted entries. No twin is caught
 *      on all 72, and the shortfalls say which arm each belongs to: 24 of the entries tear down
 *      and 48 queue, so a twin that only gets the queueing wrong tops out at 48 and one about
 *      the teardown at 24.
 *
 * HOLE: one backdrop. The ring's write cursor and one guard byte are forced, but the rest of the
 * ring is whatever the session left, so a ring congested SOMEWHERE ELSE is not covered.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-1253.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_1253 } from "../loc_1253.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";
import { offsetAddress } from "../offsetAddress.js";
import { postCommand } from "../postCommand.js";
import { COMMAND_RING, PLAY_ACTIVE, SEQUENCE_PHASE, SEQUENCE_SUBSTEP, ACTIVE_PLAYER, SEQUENCE_DELAY } from "../names.js";
import { loc_1253 as oracle } from "../../translated/loc_1253.js";
import { loc_11ed } from "../../translated/loc_11ed.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8 } from "../../../../core/int.js";

const TARGET = 0x1253;
const skip = romsPresent() ? false : "ROM images are gitignored and absent";
/** The one caller that really runs. It reaches this routine on a branch it never takes. */
const LIVE_CALLER = 0x11ed;

const SCRATCH_BYTES = 4;
const TIMER_RELOAD = 180;
const FIRST_COMMAND = 2;
const FIRST_ARGUMENT = 9;
const SECOND_COMMAND = 10;
const SECOND_ARGUMENT = 11;
const RESTART_PHASE_CELL = 0x16d3;
const FOLD_ADDEND_CELL = 0x4901;
const FOLD_BASE_CELL = 0x4902;
const FOLD_BIAS = 155;

const WRITE_CURSOR = 0xa9b2;

const CORPUS_FRAMES = 2000;
const TAPES = [["shared", {}], ["attract", { tape: [] }]];
/**
 * The two arms move different sets, so each is pinned apart: the queueing arm reaches the ring
 * through a helper that leaves an address pair behind, and the teardown arm does not.
 */
const EXCLUDED_QUEUEING = ["a", "f", "h", "l", "sp"];
const EXCLUDED_TEARDOWN = ["a", "f", "sp"];

const PLAY_STATES = [0, 1, 0xff];
const UP_STATES = [0, 1, 0xff];
const CURSORS = [0, 4, 60, 62];
const GUARDS = [0xff, 0x00];
/** A point on the queueing arm, with the ring free so both pairs really go out. */
const LIVE_POINT = { play: 0xff, up: 0, cursor: 4, guard: 0xff };
/** A point on the teardown arm. */
const TEARDOWN_POINT = { play: 0, up: 0xff, cursor: 4, guard: 0xff };

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: frozen=${d.a} candidate=${d.b}` : "identical");

// ── the session, and the entry built off it ─────────────────────────────────────────────

let session = null;
function sessionRun() {
  if (session) return session;
  let host = null;
  let threw = null;
  try {
    unitEquivalence((overrides) => (host = makeMachine(overrides)), TARGET, oracle, loc_1253, {
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

const inScratch = (addr, sp) => addr >= sp - SCRATCH_BYTES && addr < sp;

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** Masked RAM, then the command pair the queueing arm leaves in the registers. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  if (a.regs.de !== b.regs.de) return { addr: null, a: a.regs.de, b: b.regs.de };
  return null;
}

function craft({ play, up, cursor, guard }) {
  const m = pristine().clone();
  m.mem8[PLAY_ACTIVE] = play;
  m.mem8[ACTIVE_PLAYER] = up;
  m.mem8[WRITE_CURSOR] = cursor;
  m.mem8[COMMAND_RING + cursor] = guard;
  return m;
}

const POINTS = [];
for (const play of PLAY_STATES) {
  for (const up of UP_STATES) {
    for (const cursor of CURSORS) {
      for (const guard of GUARDS) POINTS.push({ play, up, cursor, guard });
    }
  }
}

function sweepCaught(candidate) {
  let caught = 0;
  for (const spec of POINTS) if (unitDiff(candidate, craft(spec))) caught++;
  return caught;
}

function dispatchCounts(opts) {
  let target = 0;
  let caller = 0;
  const m = makeMachine(
    new Map([
      [TARGET, (mm) => (target++, oracle(mm))],
      [LIVE_CALLER, (mm) => (caller++, loc_11ed(mm))],
    ]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { target, caller };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

function step(m, {
  bumpForSecondPlayer = true, firstCommand = FIRST_COMMAND, secondCommand = SECOND_COMMAND,
  armTimer = true, advance = true, reloadPhase = true, foldBias = FOLD_BIAS,
} = {}) {
  const { regs, mem8 } = m;
  if (mem8[PLAY_ACTIVE] === 0) {
    mem8[PLAY_ACTIVE] = 0;
    mem8[SEQUENCE_SUBSTEP] = 0;
    mem8[ACTIVE_PLAYER] = 0;
    if (reloadPhase) mem8[SEQUENCE_PHASE] = mem8[RESTART_PHASE_CELL];
    regs.a = mem8[FOLD_ADDEND_CELL];
    regs.hl = m.mem16[FOLD_BASE_CELL];
    const folded = offsetAddress(m);
    mem8[SEQUENCE_SUBSTEP] = u8((u8(folded) ^ (folded >> 8)) - foldBias);
    return;
  }
  regs.d = firstCommand;
  regs.e = FIRST_ARGUMENT + (bumpForSecondPlayer && mem8[ACTIVE_PLAYER] !== 0 ? 1 : 0);
  postCommand(m);
  regs.d = secondCommand;
  regs.e = SECOND_ARGUMENT;
  postCommand(m);
  if (armTimer) mem8[SEQUENCE_DELAY] = TIMER_RELOAD;
  if (advance) advanceSequenceSubStep(m);
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the first pair's argument never rises for the second player. */
function brokenNeverBumpsTheArgument(m) {
  step(m, { bumpForSecondPlayer: false });
}

/** BUG: the first pair asks for the neighbouring thing. */
function brokenWrongFirstCommand(m) {
  step(m, { firstCommand: FIRST_COMMAND + 1 });
}

/** BUG: the countdown is never armed, so whatever waits on it waits forever. */
function brokenNeverArmsTheTimer(m) {
  step(m, { armTimer: false });
}

/** BUG: the sequence never moves on, so this step runs again next frame. */
function brokenNeverAdvances(m) {
  step(m, { advance: false });
}

/** BUG: the teardown leaves the outer phase wherever it was. */
function brokenTeardownKeepsThePhase(m) {
  step(m, { reloadPhase: false });
}

/** BUG: the teardown's fold is biased one out, so the inner index ends non-zero. */
function brokenFoldOffByOne(m) {
  step(m, { foldBias: FOLD_BIAS + 1 });
}

/** BUG: the two pairs go out in the other order. */
function brokenSwapsThePairs(m) {
  const { regs, mem8 } = m;
  if (mem8[PLAY_ACTIVE] === 0) {
    step(m);
    return;
  }
  regs.d = SECOND_COMMAND;
  regs.e = SECOND_ARGUMENT;
  postCommand(m);
  regs.d = FIRST_COMMAND;
  regs.e = FIRST_ARGUMENT + (mem8[ACTIVE_PLAYER] !== 0 ? 1 : 0);
  postCommand(m);
  mem8[SEQUENCE_DELAY] = TIMER_RELOAD;
  advanceSequenceSubStep(m);
}

const TWINS = [
  ["no-op", brokenNoOp, 72],
  ["never-bumps-the-argument", brokenNeverBumpsTheArgument, 16],
  ["wrong-first-command", brokenWrongFirstCommand, 24],
  ["never-arms-the-timer", brokenNeverArmsTheTimer, 48],
  ["never-advances", brokenNeverAdvances, 48],
  ["teardown-keeps-the-phase", brokenTeardownKeepsThePhase, 24],
  ["fold-off-by-one", brokenFoldOffByOne, 24],
  ["swaps-the-pairs", brokenSwapsThePairs, 48],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: its one live caller takes the other branch every time", { skip }, () => {
  assert.notEqual(sessionRun().threw, null, "the shared tape now reaches this routine, so the " +
    "strict unit-capture gate is available and this file should use it");
  assert.match(String(sessionRun().threw), /never entered/, "the harness failed for another reason");
  const driven = dispatchCounts({});
  assert.equal(driven.target, 0, "the driven session now dispatches this routine");
  assert.ok(driven.caller > 0, "its caller no longer runs either, so this arm no longer shows " +
    "that the branch rather than the caller is what is untaken");
  assert.equal(dispatchCounts({ tape: [] }).target, 0, "the undriven session now dispatches it");
  console.log(
    `  UNREACHED: 0 dispatches over ${TAPES.length} sessions, while its caller runs ` +
      `${driven.caller} times on the driven one and branches elsewhere each time`,
  );
});

test("NOT VACUOUS: an empty candidate FAILS on BOTH arms", { skip }, () => {
  const queueing = unitDiff(brokenNoOp, craft(LIVE_POINT));
  const teardown = unitDiff(brokenNoOp, craft(TEARDOWN_POINT));
  assert.notEqual(queueing, null, "the comparison passed an empty candidate on the queueing arm");
  assert.notEqual(teardown, null, "the comparison passed an empty candidate on the teardown arm");
  console.log(`  NOT VACUOUS: queueing ${show(queueing)}; teardown ${show(teardown)}`);
});

test("EXCLUDED, deliberately: registers and pc, pinned on each arm apart", { skip }, () => {
  for (const [point, expected] of [
    [LIVE_POINT, EXCLUDED_QUEUEING],
    [TEARDOWN_POINT, EXCLUDED_TEARDOWN],
  ]) {
    const a = craft(point);
    const b = a.clone();
    oracle(a);
    loc_1253(b);
    assert.deepEqual(
      REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
      expected,
      "the excluded set changed shape: the command pair is a live-out and must not appear here",
    );
    assert.notEqual(a.pc, b.pc, "the frozen routine's return moves pc; the rewrite returns to JS");
  }
  console.log(
    `  EXCLUDED: ${EXCLUDED_QUEUEING.join(", ")} when queueing, ` +
      `${EXCLUDED_TEARDOWN.join(", ")} when tearing down, and pc in both`,
  );
});

test("CRAFTED: both flags against the ring's free, occupied and wrapping states", { skip }, () => {
  assert.equal(sweepCaught(loc_1253), 0, "the rewrite diverged somewhere in the crafted space");
  const teardown = POINTS.filter((p) => p.play === 0).length;
  assert.ok(teardown > 0 && teardown < POINTS.length, "the sweep no longer reaches both arms");
  console.log(
    `  CRAFTED: ${POINTS.length} entries identical, ${teardown} of them on the teardown arm`,
  );
});

test("THE FOLD NETS TO NOTHING on this image, so both stores agree", { skip }, () => {
  const m = craft(TEARDOWN_POINT);
  m.mem8[SEQUENCE_SUBSTEP] = 0xa5;
  loc_1253(m);
  assert.equal(
    m.mem8[SEQUENCE_SUBSTEP],
    0,
    "the fold over the program image no longer comes back to zero, so the second store of the " +
      "inner index is not the same as the first and the header must say what it leaves instead",
  );
  console.log("  FOLD: the teardown's second store of the inner index lands on zero, as the first");
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `the ${label} twin's catch count moved`);
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${POINTS.length} crafted entries`);
  });
}

// SPDX-License-Identifier: GPL-3.0-only
/**
 * destroyFixedTargetReachedByPlayer — memory-equivalent to the frozen oracle at ROM 0x507E.
 *
 * ★ THE REAL DISPATCHES ARE VACUOUS ON RAM AND THIS GATE MEASURES IT. Every dispatch the attract
 *   run produces fails one of the four tests, so nothing is written and a do-nothing candidate is
 *   byte-identical at each. That is asserted below; the destroying path is reached only by
 *   crafting, and the per-twin counts say which twins depend on it.
 *
 * GATE: strict unit-capture on the undriven attract run with ONE exclusion, every captured
 *   dispatch replayed, a crafted cross over the two flags and both coordinates, a masked
 *   whole-machine replay, and teeth.
 *   1. EQUAL at the real dispatch — identical outside an eight-byte stack-scratch window, which is
 *      what the scoring transfer at the end brackets its work with. Every arm PINS that window by
 *      walking the whole dump.
 *   2. VACUITY, MEASURED — a no-op passes at every real dispatch; the crafted arm that catches it
 *      is named.
 *   3. EXCLUDED, deliberately, BOUNDED by a measured set: a register diverging outside it fails
 *      the arm, and a rewrite that diverges on fewer of them still passes.
 *   4. CORPUS — every dispatch the attract run produces, with the flag pairs it presented.
 *   5. CRAFTED CROSS — both flags live or not, and the target's two coordinates swept across the
 *      window edge on each axis. The two axes have DIFFERENT window widths and the cross covers
 *      each separately, so a candidate using one width for both is caught.
 *   6. IT IS WHOLE-OR-NOTHING — for each of the four tests in turn, the arm forces that one test to
 *      fail with the other three passing and asserts nothing at all is written.
 *   7. WHOLE-MACHINE — the session replayed with the rewrite wired through a measured shim.
 *   8. TEETH — nine twins, each caught on an exact declared count.
 *
 * HOLE: the scoring transfer at the end is exercised, but nothing here checks WHAT it posts. That
 *   belongs to the routine it transfers to.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-507e.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { destroyFixedTargetReachedByPlayer } from "../destroyFixedTargetReachedByPlayer.js";
import { loc_507e as oracle } from "../../translated/loc_507e.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { postChainedHitScore } from "../postChainedHitScore.js";
import { BOMBER_HITS_TO_ABSORB, PLAYER_STATE } from "../names.js";

const TARGET = 0x507e;

const TARGET_ENTRY = 0xaa10;
const TARGET_FIRST_AXIS = 0;
const TARGET_SECOND_AXIS = 0x31;
const MOVER_FIRST_AXIS = 0xaa28;
const MOVER_SECOND_AXIS = 0xaa59;
const FIRST_AXIS_SLACK = 6;
const FIRST_AXIS_WINDOW = 0x0d;
const SECOND_AXIS_SLACK = 0x18;
const SECOND_AXIS_WINDOW = 0x21;
const MOVER_FLAG = 0xa8c0;
const LIVE = 0xff;
const DESTROYED = 0xf0;

const SCRATCH_BYTES = 8;
/**
 * The registers allowed to diverge: the accumulator and flags carry each of the four tests, the
 * record base is loaded into IX and the rewrite does not load it, and the closing transfer lifts
 * SP. A BOUND, not an exact list: a register diverging outside this set fails the arm below, and a
 * rewrite that diverges on fewer of them still passes. Everything else — BC, DE, HL, IY and the
 * whole shadow bank — is deliberately absent, so none of it can be excused here.
 */
const MOVED = ["a", "f", "ix", "sp"];
const FRAMES = 1600;
const RET_TSTATES = 10;

/** Measured over the corpus below; a move is a finding. */
const DISPATCHES = 240;

const FLAGS = [LIVE, DESTROYED];
const ACROSS = [0, 6, 7, 12, 13, 250, 255];
const ALONG = [0, 0x18, 0x19, 0x20, 0x21, 240, 255];
const SWEEP_SIZE = FLAGS.length * FLAGS.length * ACROSS.length * ALONG.length;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

const factory = (overrides) => makeMachine(overrides, { tape: [] });

// ── the entry, and the masked comparison ────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(factory, TARGET, oracle, (m) => {
    if (entry === null) entry = m.clone();
    return candidate(m);
  }, { maxFrames: FRAMES });
}

function entryState() {
  if (entry === null) gate(destroyFixedTargetReachedByPlayer);
  return entry;
}

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

function ramDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

const unitDiff = ramDiff;
const caught = (candidate, machine) => {
  try {
    return unitDiff(candidate, machine) !== null;
  } catch {
    return true;
  }
};

// ── the corpus ──────────────────────────────────────────────────────────────────────────

let corpus = null;
function captureCorpus() {
  if (corpus) return corpus;
  const entries = [];
  const shapes = new Set();
  let noOpSeen = 0;
  const m = factory(new Map([[TARGET, (mm) => {
    entries.push(mm.clone());
    shapes.add(`${hex4(mm.mem8[PLAYER_STATE])}/${hex4(mm.mem8[MOVER_FLAG])}`);
    if (ramDiff(() => {}, mm) !== null) noOpSeen++;
    return oracle(mm);
  }]]));
  const frames = m.runFrames(FRAMES);
  assert.equal(m.stoppedBy, null, `corpus run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, FRAMES, "corpus run ran short");
  corpus = { entries, shapes, noOpSeen };
  return corpus;
}

/** A real captured machine with both flags and both coordinates forced. */
function craft(targetFlag, moverFlag, across, along) {
  const m = entryState().clone();
  m.mem8[PLAYER_STATE] = targetFlag;
  m.mem8[MOVER_FLAG] = moverFlag;
  m.mem8[TARGET_ENTRY + TARGET_FIRST_AXIS] = 0x80;
  m.mem8[TARGET_ENTRY + TARGET_SECOND_AXIS] = 0x60;
  m.mem8[MOVER_FIRST_AXIS] = (0x80 + across) & 0xff;
  m.mem8[MOVER_SECOND_AXIS] = (0x60 + along) & 0xff;
  m.mem8[BOMBER_HITS_TO_ABSORB] = 2; // non-zero, so the twin that fails to reset it has something to fail at
  return m;
}

function sweepCaught(candidate) {
  let n = 0;
  for (const t of FLAGS) {
    for (const v of FLAGS) {
      for (const a of ACROSS) for (const b of ALONG) if (caught(candidate, craft(t, v, a, b))) n++;
    }
  }
  return n;
}

/** The one crafted entry where all four tests pass, which is the only path that writes. */
const hitting = () => craft(LIVE, LIVE, 0, 0);

// ── the shim and the masked whole-run comparison ────────────────────────────────────────

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

let baseline = null;
function wholeRunCells(candidate) {
  if (baseline === null) {
    const base = factory();
    const frames = base.runFrames(FRAMES);
    assert.equal(base.stoppedBy, null, `baseline stopped early: ${base.stoppedBy}`);
    baseline = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o) };
  }
  let fired = 0;
  const host = factory(new Map([[TARGET, (mm) => (fired++, candidate(mm))]]));
  let hostFrames = [];
  let threw = null;
  try {
    hostFrames = host.runFrames(FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(baseline.frames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = baseline.frames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) cells.add(baseline.offsetToAddr(o));
  }
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw, stopped: host.stoppedBy };
}

function scratchUnion() {
  const sps = new Set();
  for (const e of captureCorpus().entries) sps.add(e.regs.sp);
  const out = new Set();
  for (const sp of sps) for (let i = 1; i <= SCRATCH_BYTES; i++) out.add(sp - i);
  return [...out];
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

const across = (m) => (m.mem8[MOVER_FIRST_AXIS] - m.mem8[TARGET_ENTRY + TARGET_FIRST_AXIS] +
  FIRST_AXIS_SLACK) & 0xff;
const along = (m) => (m.mem8[MOVER_SECOND_AXIS] - m.mem8[TARGET_ENTRY + TARGET_SECOND_AXIS] +
  SECOND_AXIS_SLACK) & 0xff;

function destroy(m, { keepStage = false, keepTarget = false, keepMover = false, noScore = false } = {}) {
  if (!keepTarget) m.mem8[PLAYER_STATE] = DESTROYED;
  if (!keepMover) m.mem8[MOVER_FLAG] = DESTROYED;
  if (!keepStage) m.mem8[BOMBER_HITS_TO_ABSORB] = 0;
  if (!noScore) postChainedHitScore(m);
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the target's own liveness is not checked, so a spent one is destroyed again. */
function brokenIgnoresTargetFlag(m) {
  if (m.mem8[MOVER_FLAG] !== LIVE) return;
  if (across(m) >= FIRST_AXIS_WINDOW || along(m) >= SECOND_AXIS_WINDOW) return;
  destroy(m);
}

/** BUG: the mover's liveness is not checked, so one shot can take two things. */
function brokenIgnoresMoverFlag(m) {
  if (m.mem8[PLAYER_STATE] !== LIVE) return;
  if (across(m) >= FIRST_AXIS_WINDOW || along(m) >= SECOND_AXIS_WINDOW) return;
  destroy(m);
}

/** BUG: the same window width is used on both axes, so one of them is the wrong size. */
function brokenOneWindowForBoth(m) {
  if (m.mem8[PLAYER_STATE] !== LIVE || m.mem8[MOVER_FLAG] !== LIVE) return;
  if (across(m) >= FIRST_AXIS_WINDOW) return;
  if (((m.mem8[MOVER_SECOND_AXIS] - m.mem8[TARGET_ENTRY + TARGET_SECOND_AXIS] + FIRST_AXIS_SLACK) &
    0xff) >= FIRST_AXIS_WINDOW) return;
  destroy(m);
}

/** BUG: only one axis is tested, so anything in the same column is destroyed. */
function brokenOneAxis(m) {
  if (m.mem8[PLAYER_STATE] !== LIVE || m.mem8[MOVER_FLAG] !== LIVE) return;
  if (across(m) >= FIRST_AXIS_WINDOW) return;
  destroy(m);
}

/** BUG: the stage cell is left standing, so what it tracks does not reset. */
function brokenKeepsStage(m) {
  if (m.mem8[PLAYER_STATE] !== LIVE || m.mem8[MOVER_FLAG] !== LIVE) return;
  if (across(m) >= FIRST_AXIS_WINDOW || along(m) >= SECOND_AXIS_WINDOW) return;
  destroy(m, { keepStage: true });
}

/** BUG: the mover survives its own hit. */
function brokenMoverSurvives(m) {
  if (m.mem8[PLAYER_STATE] !== LIVE || m.mem8[MOVER_FLAG] !== LIVE) return;
  if (across(m) >= FIRST_AXIS_WINDOW || along(m) >= SECOND_AXIS_WINDOW) return;
  destroy(m, { keepMover: true });
}

/** BUG: the hit is recorded and no score is posted. */
function brokenNoScore(m) {
  if (m.mem8[PLAYER_STATE] !== LIVE || m.mem8[MOVER_FLAG] !== LIVE) return;
  if (across(m) >= FIRST_AXIS_WINDOW || along(m) >= SECOND_AXIS_WINDOW) return;
  destroy(m, { noScore: true });
}

/** BUG: the score is posted whether or not anything was reached. */
function brokenAlwaysScores(m) {
  if (m.mem8[PLAYER_STATE] !== LIVE || m.mem8[MOVER_FLAG] !== LIVE) {
    postChainedHitScore(m);
    return;
  }
  if (across(m) >= FIRST_AXIS_WINDOW || along(m) >= SECOND_AXIS_WINDOW) {
    postChainedHitScore(m);
    return;
  }
  destroy(m);
}

/** Per twin: exact catch count over the crafted cross, and its verdict at the real dispatch. */
const TWINS = [
  ["no-op", brokenNoOp, 12, false],
  ["ignores-target-flag", brokenIgnoresTargetFlag, 12, false],
  ["ignores-mover-flag", brokenIgnoresMoverFlag, 12, false],
  ["one-window-for-both", brokenOneWindowForBoth, 4, false],
  ["one-axis", brokenOneAxis, 16, false],
  ["keeps-stage", brokenKeepsStage, 12, false],
  ["mover-survives", brokenMoverSurvives, 12, false],
  ["no-score", brokenNoScore, 12, false],
  ["always-scores", brokenAlwaysScores, 184, true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  gate(destroyFixedTargetReachedByPlayer);
  assert.notEqual(entry, null, "vacuous: the attract run never reached the routine");
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  destroyFixedTargetReachedByPlayer(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  console.log(`  EQUAL: sp ${hex4(sp)}; nothing outside the ${SCRATCH_BYTES}-byte window moves`);
});

test("VACUITY, MEASURED: RAM sees nothing at any real dispatch", { skip }, () => {
  const { entries, noOpSeen } = captureCorpus();
  assert.equal(
    noOpSeen,
    0,
    "a real dispatch caught a do-nothing candidate, so the destroying path IS reached in play and " +
      "the framing of this file has to be re-derived",
  );
  assert.notEqual(
    ramDiff(brokenNoOp, hitting()),
    null,
    "the crafted hit must catch what the real dispatches cannot",
  );
  console.log(`  VACUITY: RAM sees a no-op at 0 of ${entries.length} real dispatches; crafted does`);
});

test("EXCLUDED, deliberately: scratch registers, the record base and pc", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  destroyFixedTargetReachedByPlayer(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !MOVED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: ${MOVED.join(", ")} and pc, plus ${SCRATCH_BYTES} scratch bytes`);
});

test("CORPUS: every captured dispatch replays identically", { skip }, () => {
  const { entries, shapes } = captureCorpus();
  assert.equal(entries.length, DISPATCHES, "the dispatch count moved");
  for (const captured of entries) {
    assert.equal(unitDiff(destroyFixedTargetReachedByPlayer, captured), null, "a captured dispatch diverged");
  }
  console.log(`  CORPUS: ${entries.length} dispatches over ${shapes.size} flag pairs`);
});

test("CRAFTED: every flag and coordinate combination is identical", { skip }, () => {
  for (const t of FLAGS) {
    for (const v of FLAGS) {
      for (const a of ACROSS) {
        for (const b of ALONG) {
          const d = unitDiff(destroyFixedTargetReachedByPlayer, craft(t, v, a, b));
          assert.equal(d, null, `${hex4(t)}/${hex4(v)}/${a}/${b}: ${show(d)}`);
        }
      }
    }
  }
  console.log(`  CRAFTED: ${SWEEP_SIZE} combinations identical`);
});

test("IT IS WHOLE-OR-NOTHING: each test failing alone writes nothing", { skip }, () => {
  const hit = hitting();
  const after = hit.clone();
  destroyFixedTargetReachedByPlayer(after);
  assert.notEqual(after.mem8[PLAYER_STATE], LIVE, "the crafted hit must actually destroy something");

  const failures = [
    ["target spent", craft(DESTROYED, LIVE, 0, 0)],
    ["mover spent", craft(LIVE, DESTROYED, 0, 0)],
    ["outside the first axis", craft(LIVE, LIVE, 13, 0)],
    ["outside the second axis", craft(LIVE, LIVE, 0, 0x21)],
  ];
  for (const [label, m] of failures) {
    const before = m.dumpState();
    destroyFixedTargetReachedByPlayer(m);
    assert.deepEqual([...m.dumpState()], [...before], `${label}: something was written anyway`);
  }
  console.log(`  WHOLE-OR-NOTHING: ${failures.length} single failures each write nothing`);
});

test("WHOLE-MACHINE: the session differs only inside the scratch windows", { skip }, () => {
  const r = wholeRunCells(hosted(destroyFixedTargetReachedByPlayer));
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early: ${r.stopped}`);
  assert.equal(r.frames, FRAMES, `compared ${r.frames} of ${FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  const window = scratchUnion();
  const escaped = r.cells.filter((c) => !window.includes(c));
  assert.deepEqual(escaped, [], `a divergence escaped the scratch windows: ${escaped.map(hex4)}`);
  console.log(`  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, ${r.cells.length} cells`);
});

test("TEETH: removing the shim's return kills the run, so the shim is load-bearing", { skip }, () => {
  const r = wholeRunCells(destroyFixedTargetReachedByPlayer);
  assert.ok(
    r.threw !== null || r.stopped !== null,
    "the run COMPLETED without the shim, so the callers no longer expect a return",
  );
  console.log(`  TEETH/shim: the unshimmed rewrite dies — ${r.threw ?? r.stopped}`);
});

for (const [label, twin, swept, seenAtDispatch] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), swept, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${swept} of ${SWEEP_SIZE} crafted entries`);
  });

  test(`TEETH: the ${label} twin at the real dispatch, hole pinned`, { skip }, () => {
    const seen = caught(twin, entryState());
    assert.equal(seen, seenAtDispatch, `the real dispatch's view of the ${label} twin moved`);
    console.log(`  TEETH/${label}: real dispatch ${seen ? "catches it" : "is BLIND, as recorded"}`);
  });
}

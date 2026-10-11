// SPDX-License-Identifier: GPL-3.0-only
/**
 * markEra1BomberAndShotHitByShots — memory-equivalent to the frozen oracle at ROM 0x4F7E.
 *
 * GATE: strict unit-capture on the undriven attract run with ONE exclusion, every captured dispatch
 *   replayed, a crafted cross over the shared flag, the slots' occupancy and both coordinates, a
 *   masked whole-machine replay, and teeth.
 *   1. EQUAL at the real dispatch — identical outside an eight-byte stack-scratch window, which is
 *      what the scoring call inside the sweep brackets its work with. No register is pinned: the
 *      routine's live-out is memory only (arm 3). Every arm PINS the window by walking the whole
 *      dump.
 *   2. VACUITY, MEASURED — a no-op is invisible at almost every real dispatch, because almost none
 *      of them reaches anything. The exact count is asserted; the crafted cross is where the
 *      destroying path is gated.
 *   3. NO REGISTER LIVE-OUT, MEASURED ON THE ORACLE — the ROM leaves E (second-axis slack), IY
 *      (slot cursor) and F (carry) changed, but its one caller (0x4EBC) reloads DE and IY before
 *      its next sweep and every path after overwrites the carry before reading it. DEAD AT EXIT
 *      (assertDeadAtExit) poisons all three as the FROZEN routine hands back over the whole attract
 *      session and requires nothing to move, with an exit control (SP) and an entry control (IY
 *      into 0x5185) that must be heard. So a twin that only scribbles E, IY, F or B passes, while a
 *      RAM scribble is caught.
 *   4. CORPUS — every dispatch the attract run produces, with the flag and occupancy shapes it saw.
 *   5. CRAFTED CROSS — the shared flag live or not, TWO slots (the first and the last) live or
 *      not, and their two coordinates swept across the window edge on each axis. The two axes have
 *      DIFFERENT window widths and the cross covers each separately; using the last slot as the
 *      second one is what gives the early-exit and short-sweep twins something to fail at.
 *   6. THE SWEEP DOES NOT STOP AT THE FIRST HIT — two slots are put inside the window and both are
 *      asserted to be marked, even though the shared flag was spent by the first.
 *   7. THE SLOT CURSOR STEPS THE LOW HALF ONLY — the sixth slot's address is asserted, which is
 *      what makes the array's reach a page rather than the whole space.
 *   8. WHOLE-MACHINE — the session replayed with the rewrite wired through a measured shim.
 *   9. TEETH — nine twins, each caught on an exact declared count. The one that steps the slot
 *      cursor whole is caught NOWHERE: the array is short enough that its low half never wraps,
 *      so that twin's declared count is zero and the arm above is what covers the stepping.
 *
 * HOLE: the array base and its length are fixed inside the routine, so nothing here varies either.
 * HOLE: the scoring call is exercised but nothing checks WHAT it posts; that belongs to the
 *   routine it calls.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4f7e.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { markEra1BomberAndShotHitByShots } from "../markEra1BomberAndShotHitByShots.js";
import { loc_4f7e as oracle } from "../../translated/loc_4f7e.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { u8 } from "../../../../core/int.js";
import { postChainedHitScore } from "../postChainedHitScore.js";
import { assertDeadAtExit, heardAs } from "./_deadAtExit.js";

const TARGET = 0x4f7e;

const SLOT_ARRAY = 0xaa80;
const SLOTS = 6;
const SLOT_STRIDE = 0x10;
const OCCUPANCY = 0;
const SLOT_FIRST_AXIS = 6;
const SLOT_SECOND_AXIS = 4;
const MOVER_FIRST_AXIS = 0xaa28;
const MOVER_SECOND_AXIS = 0xaa59;
const FIRST_AXIS_SLACK = 6;
const FIRST_AXIS_WINDOW = 0x0d;
const SECOND_AXIS_SLACK = 0x17;
const SECOND_AXIS_WINDOW = 0x1f;
const SHARED_FLAG = 0xa8c0;
const LIVE = 0xff;
const DESTROYED = 0xf0;

const SCRATCH_BYTES = 8;
/**
 * The frogger standard: RAM (masked over the frozen side's stack scratch) is the whole contract,
 * and only registers a caller actually reads off the file would be pinned beside it. Derived from
 * the ORACLE, there are none: E, IY and F, which the ROM leaves changed, are dead where it hands
 * back (DEAD AT EXIT measures it), and so are the box widths, the slot count and the stepped
 * accumulator. A twin that scribbles any of them is deliberately ignored.
 */
const GENUINE_LIVE_OUTS = [];
/** The registers the frozen routine leaves changed, each measured dead at its exit. */
const LEFT_CHANGED = ["e", "iy", "f"];
const SCRIBBLE_CELL = 0xa100; // a compared (non-stack) cell the control flips to prove RAM bites
const FRAMES = 1600;
const RET_TSTATES = 10;

/** Measured over the corpus below; a move is a finding. */
const DISPATCHES = 240;
const NO_OP_SEEN = 4;

const FLAGS = [LIVE, DESTROYED];
const OCCUPANCIES = [LIVE, 0x00];
const ACROSS = [0, 6, 7, 12, 13, 250, 255];
const ALONG = [0, 0x17, 0x18, 0x1e, 0x1f, 240, 255];
const SWEEP_SIZE = FLAGS.length * OCCUPANCIES.length * ACROSS.length * ALONG.length;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

const factory = (overrides) => makeMachine(overrides, { tape: [] });

const slotAt = (i) => (SLOT_ARRAY & 0xff00) | ((SLOT_ARRAY + SLOT_STRIDE * i) & 0xff);

// ── the entry, and the masked comparison ────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(factory, TARGET, oracle, (m) => {
    if (entry === null) entry = m.clone();
    return candidate(m);
  }, { maxFrames: FRAMES });
}

function entryState() {
  if (entry === null) gate(markEra1BomberAndShotHitByShots);
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

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

const caught = (candidate, machine) => {
  try {
    return unitDiff(candidate, machine) !== null;
  } catch {
    return true;
  }
};

/** The genuine register live-outs, pinned to the frozen side exactly. Kept OUT of unitDiff above so
 * the memory teeth stay a pure RAM measurement (the twins never seat these registers); this rides
 * only on the real candidate, in the live-out pin and its scratch-not-pinned control. */
function liveOutDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  for (const k of GENUINE_LIVE_OUTS) {
    if (a.regs[k] !== b.regs[k]) return { reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** RAM masked over the stack scratch OR a pinned live-out — the full frogger-standard contract. */
const caughtFull = (candidate, machine) => {
  try {
    return unitDiff(candidate, machine) !== null || liveOutDiff(candidate, machine) !== null;
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
    const live = Array.from({ length: SLOTS }, (_u, i) => (mm.mem8[slotAt(i)] === LIVE ? 1 : 0));
    shapes.add(`${hex4(mm.mem8[SHARED_FLAG])}/${live.join("")}`);
    if (unitDiff(() => {}, mm) !== null) noOpSeen++;
    return oracle(mm);
  }]]));
  const frames = m.runFrames(FRAMES);
  assert.equal(m.stoppedBy, null, `corpus run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, FRAMES, "corpus run ran short");
  corpus = { entries, shapes, noOpSeen };
  return corpus;
}

/** A real captured machine: the flag forced, every slot cleared, and slot zero placed by hand. */
function craft(flag, occupancy, across, along) {
  const m = entryState().clone();
  m.mem8[SHARED_FLAG] = flag;
  m.mem8[MOVER_FIRST_AXIS] = 0x80;
  m.mem8[MOVER_SECOND_AXIS] = 0x60;
  for (let i = 0; i < SLOTS; i++) {
    m.mem8[slotAt(i) + OCCUPANCY] = 0;
    m.mem8[slotAt(i) + SLOT_FIRST_AXIS] = 0x00;
    m.mem8[slotAt(i) + SLOT_SECOND_AXIS] = 0x00;
  }
  // TWO slots, the first and the LAST, given the same position: a sweep that stops early, that
  // re-tests the shared flag, that steps its cursor whole, or that runs one slot short all fail
  // to reach the second one, and the twin counts below are what says so.
  for (const i of [0, SLOTS - 1]) {
    m.mem8[slotAt(i) + OCCUPANCY] = occupancy;
    m.mem8[slotAt(i) + SLOT_FIRST_AXIS] = (0x80 - across) & 0xff;
    m.mem8[slotAt(i) + SLOT_SECOND_AXIS] = (0x60 - along) & 0xff;
  }
  return m;
}

function sweepCaught(candidate) {
  let n = 0;
  for (const f of FLAGS) {
    for (const o of OCCUPANCIES) {
      for (const a of ACROSS) for (const b of ALONG) if (caught(candidate, craft(f, o, a, b))) n++;
    }
  }
  return n;
}

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

function run(m, {
  stopAtFirst = false, recheckFlag = false, oneAxis = false, oneWindow = false,
  flagSurvives = false, noScore = false, wholeCursor = false, slotsShort = 0,
} = {}) {
  const { mem8 } = m;
  if (mem8[SHARED_FLAG] !== LIVE) return;
  let slot = SLOT_ARRAY;
  for (let i = 0; i < SLOTS - slotsShort; i++) {
    if (mem8[slot + OCCUPANCY] === LIVE && (!recheckFlag || mem8[SHARED_FLAG] === LIVE)) {
      const across = (mem8[MOVER_FIRST_AXIS] - mem8[slot + SLOT_FIRST_AXIS] + FIRST_AXIS_SLACK) & 0xff;
      const alongSlack = oneWindow ? FIRST_AXIS_SLACK : SECOND_AXIS_SLACK;
      const alongWindow = oneWindow ? FIRST_AXIS_WINDOW : SECOND_AXIS_WINDOW;
      const along = (mem8[MOVER_SECOND_AXIS] - mem8[slot + SLOT_SECOND_AXIS] + alongSlack) & 0xff;
      if (across < FIRST_AXIS_WINDOW && (oneAxis || along < alongWindow)) {
        if (!flagSurvives) mem8[SHARED_FLAG] = DESTROYED;
        mem8[slot + OCCUPANCY] = DESTROYED;
        if (!noScore) postChainedHitScore(m);
        if (stopAtFirst) return;
      }
    }
    slot = wholeCursor ? slot + SLOT_STRIDE : (slot & 0xff00) | ((slot + SLOT_STRIDE) & 0xff);
  }
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: stops at the first slot reached, so one pass cannot take two. */
function brokenStopsAtFirst(m) {
  run(m, { stopAtFirst: true });
}

/** BUG: re-tests the shared flag inside the sweep, so a second slot in reach survives. */
function brokenRechecksFlag(m) {
  run(m, { recheckFlag: true });
}

/** BUG: only one axis is tested, so anything in the same column is destroyed. */
function brokenOneAxis(m) {
  run(m, { oneAxis: true });
}

/** BUG: the same window is used on both axes, so one of them is the wrong size. */
function brokenOneWindowForBoth(m) {
  run(m, { oneWindow: true });
}

/** BUG: the shared flag survives, so nothing records that the mover was spent. */
function brokenFlagSurvives(m) {
  run(m, { flagSurvives: true });
}

/** BUG: the hit is recorded and no score is posted. */
function brokenNoScore(m) {
  run(m, { noScore: true });
}

/** BUG: the slot cursor steps whole rather than by its low half alone. */
function brokenWholeCursor(m) {
  run(m, { wholeCursor: true });
}

/** BUG: one slot short, so the last of the array is never tested. */
function brokenOneSlotShort(m) {
  run(m, { slotsShort: 1 });
}

/** Per twin: exact catch count over the crafted cross, and its verdict at the real dispatch. */
const TWINS = [
  ["no-op", brokenNoOp, 12, false],
  ["stops-at-first", brokenStopsAtFirst, 12, false],
  ["rechecks-flag", brokenRechecksFlag, 12, false],
  ["one-axis", brokenOneAxis, 16, false],
  ["one-window-for-both", brokenOneWindowForBoth, 4, false],
  ["flag-survives", brokenFlagSurvives, 12, false],
  ["no-score", brokenNoScore, 12, false],
  ["whole-cursor", brokenWholeCursor, 0, false],
  ["one-slot-short", brokenOneSlotShort, 12, false],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  gate(markEra1BomberAndShotHitByShots);
  assert.notEqual(entry, null, "vacuous: the attract run never reached the routine");
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  markEra1BomberAndShotHitByShots(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(liveOutDiff(markEra1BomberAndShotHitByShots, entryState()), null, "a pinned live-out diverged");
  console.log(`  EQUAL: sp ${hex4(sp)}; nothing outside the ${SCRATCH_BYTES}-byte window moves`);
});

test("VACUITY, MEASURED: a no-op is invisible at almost every real dispatch", { skip }, () => {
  const { entries, noOpSeen } = captureCorpus();
  assert.equal(noOpSeen, NO_OP_SEEN, "the fraction of dispatches a no-op is visible at moved");
  assert.ok(
    noOpSeen < entries.length / 2,
    "a no-op is now visible at most dispatches, so the destroying path is common in play and this " +
      "file's account of where the teeth are has to be re-derived",
  );
  assert.notEqual(
    unitDiff(brokenNoOp, craft(LIVE, LIVE, 0, 0)),
    null,
    "the crafted hit must catch a no-op",
  );
  console.log(`  VACUITY: a no-op shows at ${noOpSeen} of ${entries.length} real dispatches`);
});

test("NO REGISTER PINNED, RAM IS: dead-register scribbles pass; a RAM scribble bites", { skip }, () => {
  // The frogger standard with the oracle-derived live-out set, which is empty (DEAD AT EXIT below):
  // a twin that only scribbles a register the ROM leaves changed (E, IY, F) or one it uses as
  // scratch (B) is DELIBERATELY not flagged, and the same measurement must still catch a scribbled
  // RAM cell, or the clean read on the register twins is worthless.
  assert.deepEqual(GENUINE_LIVE_OUTS, [], "a register live-out was declared; derive it from the oracle and measure it");
  const scribbleDeadReg = (m) => { markEra1BomberAndShotHitByShots(m); m.regs.b = u8(m.regs.b + 1); };
  const scribbleLeftChanged = (m) => {
    markEra1BomberAndShotHitByShots(m);
    m.regs.e = u8(m.regs.e + 1); m.regs.iy = (m.regs.iy + 2) & 0xffff; m.regs.f ^= 0x01;
  };
  const scribbleData = (m) => { markEra1BomberAndShotHitByShots(m); m.mem8[SCRIBBLE_CELL] ^= 0xff; };
  assert.equal(caughtFull(scribbleDeadReg, entryState()), false, "a dead-register scribble was flagged, but B is not a live-out");
  assert.equal(caughtFull(scribbleLeftChanged, entryState()), false, "an E/IY/F scribble was flagged, but they are dead at exit");
  assert.equal(caughtFull(scribbleData, entryState()), true, "a scribbled RAM cell went uncaught, so the RAM measurement has no teeth");
  console.log("  NO REGISTER PINNED: B and E/IY/F scribbles ignored, RAM scribble caught");
});

test("DEAD AT EXIT: E, IY and F, as the frozen routine leaves them, are read by nothing after it", { skip }, () => {
  // ENTRY-SIDE CONTROL: the caller's next sweep (0x5185) reads IY; nudged one entry on the way in,
  // the instrument must hear it -- IY is heard when it is live.
  const [run] = assertDeadAtExit({
    at: TARGET, poison: LEFT_CHANGED, frames: FRAMES,
    sessions: [{ label: "attract", tape: [], dispatches: DISPATCHES }],
    controls: [{ label: "IY into 0x5185", at: 0x5185, poison: ["iy"], flip: { iy: 0x02 }, before: true }],
  });
  assert.equal(run.dead.stopped, null, `the poisoned run stopped early: ${run.dead.stopped}`);
  console.log(`  DEAD AT EXIT: exit control heard (${heardAs(run.exitControl)}); ` +
    `entry control heard (${heardAs(run.controls["IY into 0x5185"])})`);
});

test("CORPUS: every captured dispatch replays identically", { skip }, () => {
  const { entries, shapes } = captureCorpus();
  assert.equal(entries.length, DISPATCHES, "the dispatch count moved");
  for (const captured of entries) {
    assert.equal(unitDiff(markEra1BomberAndShotHitByShots, captured), null, "a captured dispatch diverged");
  }
  console.log(`  CORPUS: ${entries.length} dispatches over ${shapes.size} flag/occupancy shapes`);
});

test("CRAFTED: every flag, occupancy and coordinate combination is identical", { skip }, () => {
  for (const f of FLAGS) {
    for (const o of OCCUPANCIES) {
      for (const a of ACROSS) {
        for (const b of ALONG) {
          const d = unitDiff(markEra1BomberAndShotHitByShots, craft(f, o, a, b));
          assert.equal(d, null, `${hex4(f)}/${hex4(o)}/${a}/${b}: ${show(d)}`);
        }
      }
    }
  }
  console.log(`  CRAFTED: ${SWEEP_SIZE} combinations identical`);
});

test("THE SWEEP DOES NOT STOP AT THE FIRST HIT", { skip }, () => {
  const m = craft(LIVE, LIVE, 0, 0);
  const before = m.clone();
  oracle(before);
  markEra1BomberAndShotHitByShots(m);
  assert.equal(m.mem8[slotAt(0) + OCCUPANCY], DESTROYED, "the first slot in reach must be marked");
  const last = slotAt(SLOTS - 1) + OCCUPANCY;
  assert.equal(m.mem8[last], DESTROYED, "and so must the last, in the same pass");
  assert.equal(m.mem8[SHARED_FLAG], DESTROYED, "with the shared flag spent");
  assert.equal(before.mem8[last], DESTROYED, "and the original does the same");
  console.log("  NO EARLY EXIT: both slots in reach are marked in one pass");
});

test("THE SLOT CURSOR STEPS THE LOW HALF ONLY", { skip }, () => {
  assert.equal(slotAt(SLOTS - 1), 0xaad0, "the last slot's address moved");
  const m = craft(LIVE, LIVE, 0, 0);
  m.mem8[slotAt(0) + OCCUPANCY] = 0;
  markEra1BomberAndShotHitByShots(m);
  assert.equal(m.mem8[slotAt(SLOTS - 1) + OCCUPANCY], DESTROYED, "the last slot must be reached");
  console.log(`  CURSOR: the last slot sits at ${hex4(slotAt(SLOTS - 1))} and is swept`);
});

test("WHOLE-MACHINE: the session differs only inside the scratch windows", { skip }, () => {
  const r = wholeRunCells(hosted(markEra1BomberAndShotHitByShots));
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
  const r = wholeRunCells(markEra1BomberAndShotHitByShots);
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

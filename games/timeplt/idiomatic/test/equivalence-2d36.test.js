// SPDX-License-Identifier: GPL-3.0-only
/**
 * driftTwoTileSceneryAtThreeQuarters — memory-equivalent to the frozen oracle at ROM 0x2D36.
 *
 * GATE: strict unit-capture on the coin-and-start tape with ONE exclusion, every captured dispatch
 *   replayed, a crafted cross over the displacement cells and the coordinates, a masked
 *   whole-machine replay, and teeth.
 *   1. EQUAL at the real dispatch — identical outside a four-byte stack-scratch window, which is
 *      the two return addresses the original brackets its two calls with. Every arm PINS that
 *      window by walking the whole dump, so it cannot quietly widen.
 *   2. NOT VACUOUS — a no-op candidate fails the same masked diff on a real cell.
 *   3. EXCLUDED, deliberately, BOUNDED by a measured set rather than pinned to it: a register
 *      outside the set fails, a register that stops diverging does not. The two cursors are NOT
 *      in the set — they are live-outs, both stepped twice between the placement and the final
 *      step — so either of them left behind still fails here.
 *   4. CORPUS — every dispatch the tape produces, one at a time.
 *   5. CRAFTED CROSS — both displacement cells and all four coordinate bytes forced identically on
 *      both arms, over displacements that carry, wrap and change sign.
 *   6. ORDER MATTERS, and that is measured: the tile placement reads a coordinate the drift has
 *      just written, so an arm swaps the two and shows it is caught.
 *   7. WHOLE-MACHINE — the session replayed with the rewrite wired through a measured shim.
 *   8. TEETH — seven twins, each caught on an exact declared count.
 *
 * HOLE: the tape presents ONE pair of bases, so the crafted cross varies the values read and not
 *   the slots they are read from.
 * HOLE: the stack pointer at this entry takes two values over the session, and the exclusion is
 *   computed per comparison from the entry's own pointer rather than pinned to one address.
 * HOLE: THE CAPTURED ENTRY HAS BOTH DISPLACEMENT CELLS AT ZERO, so the drift moves nothing there
 *   and the three twins that break the drift are INVISIBLE at the real dispatch. The crafted cross
 *   is what catches them, on exactly the entries where at least one displacement is non-zero, and
 *   the per-twin counts are asserted rather than described.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2d36.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { driftTwoTileSceneryAtThreeQuarters } from "../driftTwoTileSceneryAtThreeQuarters.js";
import { loc_2d36 as oracle } from "../../translated/loc_2d36.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { advanceToNextSlot } from "../advanceToNextSlot.js";
import { driftAtThreeQuartersWorldScroll } from "../driftAtThreeQuartersWorldScroll.js";
import { driftWithWorldScroll } from "../driftWithWorldScroll.js";
import { placeAbuttingTile } from "../placeAbuttingTile.js";
import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "../names.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x2d36;

const WHOLE_FIRST = 49;
const FRACTION_FIRST = 3;
const WHOLE_SECOND = 0;
const FRACTION_SECOND = 5;

const SCRATCH_BYTES = 4;
const MOVED = ["a", "b", "c", "sp"];
const CORPUS_FRAMES = 1400;
const WHOLE_FRAMES = 1400;
const RET_TSTATES = 10;

/** Measured over the corpus below; a move is a finding. */
const DISPATCHES = 1576;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

const factory = (overrides) => makeMachine(overrides);

// ── the entry, and the masked comparison ────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(factory, TARGET, oracle, (m) => {
    if (entry === null) entry = m.clone();
    return candidate(m);
  }, { maxFrames: ENTRY_FRAMES });
}

function entryState() {
  if (entry === null) gate(driftTwoTileSceneryAtThreeQuarters);
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

/** Oracle vs candidate on clones: masked RAM first, then the two cursors. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  if (a.regs.ix !== b.regs.ix) return { addr: null, a: a.regs.ix, b: b.regs.ix };
  if (a.regs.iy !== b.regs.iy) return { addr: null, a: a.regs.iy, b: b.regs.iy };
  return null;
}

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
  const bases = new Set();
  const m = factory(new Map([[TARGET, (mm) => {
    entries.push(mm.clone());
    bases.add(`${hex4(mm.regs.ix)}/${hex4(mm.regs.iy)}`);
    return oracle(mm);
  }]]));
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `corpus run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "corpus run ran short");
  corpus = { entries, bases };
  return corpus;
}

// ── the crafted cross ───────────────────────────────────────────────────────────────────

const SCROLLS = [0x0000, 0x0001, 0x00ff, 0x0100, 0x0180, 0x7fff, 0x8000, 0xffff];
const POSITIONS = [
  { wA: 0, fA: 0, wB: 0, fB: 0 },
  { wA: 0, fA: 255, wB: 255, fB: 0 },
  { wA: 255, fA: 255, wB: 255, fB: 255 },
  { wA: 138, fA: 203, wB: 129, fB: 88 },
];

function craft(dA, dB, p) {
  const m = entryState().clone();
  m.mem16[WORLD_SCROLL_Y] = dA;
  m.mem16[WORLD_SCROLL_X] = dB;
  m.mem8[m.regs.iy + WHOLE_FIRST] = p.wA;
  m.mem8[m.regs.ix + FRACTION_FIRST] = p.fA;
  m.mem8[m.regs.iy + WHOLE_SECOND] = p.wB;
  m.mem8[m.regs.ix + FRACTION_SECOND] = p.fB;
  return m;
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const dA of SCROLLS) for (const dB of SCROLLS) for (const p of POSITIONS) out.push([dA, dB, p]);
  crossCache = out;
  return out;
}

const crossCaught = (candidate) =>
  cross().filter(([dA, dB, p]) => caught(candidate, craft(dA, dB, p))).length;

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
    const frames = base.runFrames(WHOLE_FRAMES);
    assert.equal(base.stoppedBy, null, `baseline stopped early: ${base.stoppedBy}`);
    baseline = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o) };
  }
  let fired = 0;
  const host = factory(new Map([[TARGET, (mm) => (fired++, candidate(mm))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(WHOLE_FRAMES);
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
  const live = liveStackDiffs(baseline.frames, hostFrames, floors, (o) => baseline.offsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw, stopped: host.stoppedBy };
}

/** The union of the scratch windows the session's two entry stack pointers give. */
function scratchUnion() {
  const sps = new Set();
  for (const e of captureCorpus().entries) sps.add(e.regs.sp);
  const out = new Set();
  for (const sp of sps) for (let i = 1; i <= SCRATCH_BYTES; i++) out.add(sp - i);
  return [...out].sort((a, b) => a - b);
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: places the tile and steps the slots but never carries the object with the world. */
function brokenNoDrift(m) {
  placeAbuttingTile(m);
  advanceToNextSlot(m);
}

/** BUG: drifts and steps but never places the object's second tile. */
function brokenNoTile(m) {
  driftAtThreeQuartersWorldScroll(m);
  advanceToNextSlot(m);
}

/** BUG: leaves the cursors on the object's second half, so a caller's next step lands inside it. */
function brokenNoFinalStep(m) {
  driftAtThreeQuartersWorldScroll(m);
  placeAbuttingTile(m);
}

/** BUG: carries the object at the full world pace instead of three quarters of it. */
function brokenFullPace(m) {
  driftWithWorldScroll(m);
  placeAbuttingTile(m);
  advanceToNextSlot(m);
}

/** BUG: places the tile before the drift, so the second half is a frame behind the first. */
function brokenOrderSwapped(m) {
  placeAbuttingTile(m);
  driftAtThreeQuartersWorldScroll(m);
  advanceToNextSlot(m);
}

/** BUG: steps the cursors a third time, so the caller skips a slot. */
function brokenStepsTooFar(m) {
  driftAtThreeQuartersWorldScroll(m);
  placeAbuttingTile(m);
  advanceToNextSlot(m);
  advanceToNextSlot(m);
}

/** Per twin: exact catch count over the crafted cross, and its verdict at the real dispatch. */
const TWINS = [
  ["no-op", brokenNoOp, 256, true],
  ["no-drift", brokenNoDrift, 240, false],
  ["no-tile", brokenNoTile, 256, true],
  ["no-final-step", brokenNoFinalStep, 256, true],
  ["full-pace", brokenFullPace, 240, false],
  ["order-swapped", brokenOrderSwapped, 240, false],
  ["steps-too-far", brokenStepsTooFar, 256, true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the four-byte scratch window", { skip }, () => {
  gate(driftTwoTileSceneryAtThreeQuarters);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  driftTwoTileSceneryAtThreeQuarters(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(unitDiff(driftTwoTileSceneryAtThreeQuarters, entryState()), null, "a cursor diverged");
  console.log(`  EQUAL: bases ${hex4(a.regs.ix)}/${hex4(a.regs.iy)}, sp ${hex4(sp)}`);
});

test("NOT VACUOUS: a no-op candidate FAILS the masked diff on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "and it must be caught on a real cell, not on a cursor alone");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: scratch registers and pc, but NOT the two cursors", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  driftTwoTileSceneryAtThreeQuarters(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !MOVED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: ${MOVED.join(", ")} and pc, plus ${SCRATCH_BYTES} scratch bytes`);
});

test("CORPUS: every captured dispatch replays identically", { skip }, () => {
  const { entries, bases } = captureCorpus();
  assert.equal(entries.length, DISPATCHES, "the dispatch count moved");
  for (const captured of entries) {
    assert.equal(unitDiff(driftTwoTileSceneryAtThreeQuarters, captured), null, "a captured dispatch diverged");
  }
  console.log(`  CORPUS: ${entries.length} dispatches over ${bases.size} base pairs, identical`);
});

test("CRAFTED: every displacement x position combination is identical", { skip }, () => {
  for (const [dA, dB, p] of cross()) {
    const d = unitDiff(driftTwoTileSceneryAtThreeQuarters, craft(dA, dB, p));
    assert.equal(d, null, `${hex4(dA)}/${hex4(dB)} ${JSON.stringify(p)}: ${show(d)}`);
  }
  assert.equal(cross().length, SCROLLS.length ** 2 * POSITIONS.length, "the crafted cross shrank");
  console.log(`  CRAFTED: ${cross().length} combinations identical`);
});

test("ORDER MATTERS: doing the placement first is caught", { skip }, () => {
  const swapped = cross().filter(([dA, dB, p]) => caught(brokenOrderSwapped, craft(dA, dB, p)));
  assert.ok(
    swapped.length > 0,
    "swapping the drift and the placement changed nothing anywhere in the crafted space, so the " +
      "placement does NOT read what the drift writes and this file's account of the order is wrong",
  );
  console.log(`  ORDER: the swap is caught on ${swapped.length} of ${cross().length} entries`);
});

test("WHOLE-MACHINE: the session differs only inside the scratch windows", { skip }, () => {
  const r = wholeRunCells(hosted(driftTwoTileSceneryAtThreeQuarters));
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early: ${r.stopped}`);
  assert.equal(r.frames, WHOLE_FRAMES, `compared ${r.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  const window = scratchUnion();
  const escaped = r.cells.filter((c) => !window.includes(c));
  assert.deepEqual(escaped, [], `a divergence escaped the scratch windows: ${escaped.map(hex4)}`);
  console.log(`  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, ${r.cells.length} cells`);
});

test("TEETH: removing the shim's return kills the run, so the shim is load-bearing", { skip }, () => {
  const r = wholeRunCells(driftTwoTileSceneryAtThreeQuarters);
  assert.ok(
    r.threw !== null || r.stopped !== null,
    "the run COMPLETED without the shim, so the callers no longer expect a return",
  );
  console.log(`  TEETH/shim: the unshimmed rewrite dies — ${r.threw ?? r.stopped}`);
});

for (const [label, twin, crafted, seenAtDispatch] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(crossCaught(twin), crafted, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${crafted} of ${cross().length} crafted entries`);
  });

  test(`TEETH: the ${label} twin at the real dispatch, hole pinned`, { skip }, () => {
    const seen = caught(twin, entryState());
    assert.equal(seen, seenAtDispatch, `the real dispatch's view of the ${label} twin moved`);
    console.log(`  TEETH/${label}: real dispatch ${seen ? "catches it" : "is BLIND, as recorded"}`);
  });
}

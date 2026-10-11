// SPDX-License-Identifier: GPL-3.0-only
/**
 * sweepShotsOverFiveCraftThenMotherShip — memory-equivalent to the frozen oracle at ROM 0x4FBF.
 *
 * WHAT IT IS. Two sweeps. The first is a shared routine that is ALREADY DECOMPILED, handed its
 * runs, counts and box outright, so the rewrite calls it directly and dissolving that call belongs
 * to this caller's unit. The second is this entry's own, and it is the one the crafted arms below
 * are built around.
 *
 * GATE: strict unit-capture replayed over every dispatch of an undriven attract session, plus a
 *   crafted sweep over the era, the standing object's state and its two coordinates, plus teeth.
 *
 * What it exercises, with the holes stated:
 *   1. EQUAL at the real dispatch — identical outside a ten-byte scratch window.
 *   2. THE SCRATCH WINDOW IS THE ONE EXCLUSION, pinned to [SP-10, SP). The first sweep and the
 *      score it posts each bracket their work with pushed pairs. Every arm walks the whole dump
 *      and asserts nothing escapes the window; it is an upper bound, not a prediction.
 *   3. NOT VACUOUS — a candidate that does nothing fails the same comparison, on a real cell.
 *   4. EXCLUDED, deliberately — the register set that may differ is BOUNDED by a measured list,
 *      the alternate accumulator among them: a register diverging outside it fails the arm, and a
 *      rewrite that diverges on fewer still passes. The rest of the shadow bank is outside it.
 *   5. CORPUS — every dispatch of the session replayed on a clone.
 *   6. THE CURSOR CELLS ARE STAGED — the two cells the first sweep reloads between passes are
 *      forced to a wrong value on entry and checked to be rewritten before it runs, which is the
 *      one ordering dependency between the two halves of this entry.
 *   7. CRAFTED — the standing object placed at a grid of offsets from a live shot, crossed with all
 *      five eras and three states, plus THREE further states the grid cannot reach: the reload
 *      cells left wrong, a target the shared sweep can actually destroy, and two live shots on one
 *      object. Three of the twins below are caught by those three states and by nothing else.
 *   8. THE BOX IS ERA-KEYED — the widest offset that still counts as a hit is measured per era and
 *      asserted to be one width in the first and last era and another in the middle three.
 *   9. TEETH — eight twins with exact catch counts over the crafted sweep.
 *
 * HOLE: the crafted arm moves the standing object, not the shots, and sweeps one axis at a time
 * against a fixed other axis. A candidate that got the two axes crossed would be caught by the
 * swapped-axes twin and by nothing else here.
 * HOLE: nothing says what the standing object IS. The gate fixes its state byte, its two
 * coordinate cells, and that a hit marks both it and the shot destroyed and posts a score.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4fbf.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { sweepShotsOverFiveCraftThenMotherShip } from "../sweepShotsOverFiveCraftThenMotherShip.js";
import { destroyTargetsHitByShots } from "../destroyTargetsHitByShots.js";
import { postChainedHitScore } from "../postChainedHitScore.js";
import { loc_4fbf as oracle } from "../../translated/loc_4fbf.js";
import { ERA_INDEX, MOTHER_SHIP_STATE } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x4fbf;
const FRAMES = 4200;
const DISPATCHES = 251;

const SHOT_RECORDS = 0xaa80;
const SHOTS = 6;
const RECORD_STRIDE = 16;
const TARGET_RECORDS = 0xa850;
const TARGET_ENTRIES = 0xaa1a;
const TARGETS = 5;
const TARGET_REACH = 7;
const TARGET_SPAN = 15;
const TARGET_ENTRY_CURSOR = 0xa991;
const TARGET_RECORD_CURSOR = 0xa993;

const STANDING_FIRST_AXIS = 0xaa24;
const STANDING_SECOND_AXIS = 0xaa55;
const STATE = 0;
const SHOT_FIRST_AXIS = 6;
const SHOT_SECOND_AXIS = 4;
const LIVE = 255;
const DESTROYED = 240;
const DORMANT = 0;

const WIDE_ERAS = [0, 4];
const WIDE_REACH = 8;
const WIDE_SPAN = 17;
const NARROW_REACH = 6;
const NARROW_SPAN = 13;
const SECOND_AXIS_REACH = 23;
const SECOND_AXIS_SPAN = 31;

const SCRATCH_BYTES = 10;
/**
 * The registers allowed to diverge. A BOUND, not an exact list: a register diverging outside this
 * set fails the arm below, and a rewrite that diverges on fewer of them still passes.
 *
 * IT IS WIDE, AND EVERY MEMBER WAS MEASURED MOVING. This entry stages the first sweep's runs,
 * counts and box outright — that alone is DE, IY, IX, B, C, H, L, and A', which the sweep reloads
 * its inner count from and which the ROM sets by bracketing `ld a,0x05` (0x4FCB) and `ld b,a`
 * (0x4FCD) in a pair of `ex af,af'` at 0x4FCA and 0x4FCE. ⚠ Those two addresses are NOT the ones
 * in `translated/loc_4fbf.js` beside the `exAf()` calls: `m.step`'s argument is the address of the
 * NEXT instruction, so the file reads 0x4FCB/0x4FCF for instructions that live one byte earlier.
 * It then runs its own sweep, which carries every comparison through A and F, and the closing
 * `ret` lifts SP. So the set absorbs all eleven main registers plus A'.
 *
 * What is still WATCHED is the rest of the shadow bank: F', B', C', D', E', H' and L'. B' through
 * L' are never touched by either side — checked across the whole call closure {4FBF, 51DE, 5211,
 * 0038}, which contains no `exx`. F' IS touched, by TWO `ex af,af'` pairs: the one above, and a
 * second at 0x525C/0x525E inside `loc_5211`, which this routine calls. It returns to its entry
 * value either way, because both pairs bracket only flag-neutral instructions (`ld a,0x05` /
 * `ld b,a`, and `ld b,a` again), so it does not diverge and stays outside the set. A rewrite that
 * started disturbing any of the seven fails here.
 */
const EXCLUDED = ["a", "f", "b", "c", "d", "e", "h", "l", "ix", "iy", "sp", "a_"];

const ERAS = [0, 1, 2, 3, 4];
const STATES = [LIVE, DESTROYED, DORMANT];
/** Offsets of the standing object from a planted shot, along one axis at a time. */
const OFFSETS = Array.from({ length: 41 }, (_unused, i) => i - 20);
const PLANTED_SHOT = { first: 0x60, second: 0x50 };
const EXTRA_STATES = 3;
const SWEEP_SIZE = ERAS.length * STATES.length * OFFSETS.length * 2 + EXTRA_STATES;

const skip = romsPresent() ? false : "ROM images are absent from this checkout";
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

let entry = null;

function replay(candidate) {
  let dispatches = 0;
  let caught = 0;
  const eras = new Set();
  const standing = new Set();
  const host = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    if (entry === null) entry = mm.clone();
    eras.add(mm.mem8[ERA_INDEX]);
    standing.add(mm.mem8[MOTHER_SHIP_STATE]);
    const sp = mm.regs.sp;
    const b = mm.clone();
    candidate(b);
    const r = oracle(mm);
    if (allDiffs(mm, b).some((d) => !inScratch(d.addr, sp))) caught++;
    return r;
  }]]), { tape: [] });
  const frames = host.runFrames(FRAMES);
  assert.equal(host.stoppedBy, null, `session stopped early: ${host.stoppedBy}`);
  assert.equal(frames.length, FRAMES, "session ran short");
  return { dispatches, caught, eras, standing };
}

function entryState() {
  if (entry === null) replay(sweepShotsOverFiveCraftThenMotherShip);
  assert.notEqual(entry, null, "vacuous: the attract session never reached the routine");
  return entry;
}

/**
 * A real captured machine with ONE shot planted live at a known position, every other shot
 * dormant, and the standing object placed at a chosen offset along one axis.
 */
function craft(era, state, axis, offset) {
  const m = entryState().clone();
  m.mem8[ERA_INDEX] = era;
  for (let i = 0; i < SHOTS; i++) {
    const shot = SHOT_RECORDS + i * RECORD_STRIDE;
    m.mem8[shot + STATE] = i === 0 ? LIVE : DORMANT;
    m.mem8[shot + SHOT_FIRST_AXIS] = PLANTED_SHOT.first;
    m.mem8[shot + SHOT_SECOND_AXIS] = PLANTED_SHOT.second;
  }
  m.mem8[MOTHER_SHIP_STATE] = state;
  m.mem8[STANDING_FIRST_AXIS] = (PLANTED_SHOT.first + (axis === 0 ? offset : 0)) & 0xff;
  m.mem8[STANDING_SECOND_AXIS] = (PLANTED_SHOT.second + (axis === 1 ? offset : 0)) & 0xff;
  return m;
}

function sweep(fn) {
  for (const era of ERAS) {
    for (const state of STATES) {
      for (let axis = 0; axis < 2; axis++) {
        for (const offset of OFFSETS) fn(era, state, axis, offset);
      }
    }
  }
}

/**
 * Three states the offset grid cannot reach, each aimed at one thing the grid leaves blind.
 * Without them three of the twins below are caught NOWHERE, which is how they were found.
 */
function craftUnstaged() {
  const m = craft(0, LIVE, 0, 0);
  m.mem16[TARGET_RECORD_CURSOR] = 0x0000;
  m.mem16[TARGET_ENTRY_CURSOR] = 0x0000;
  return m;
}

function craftReachableTarget() {
  const m = craft(0, DORMANT, 0, 0);
  m.mem8[TARGET_RECORDS + STATE] = LIVE;
  m.mem8[TARGET_ENTRIES] = PLANTED_SHOT.first;
  m.mem8[TARGET_ENTRIES + 49] = PLANTED_SHOT.second;
  return m;
}

function craftTwoShotsOnOne() {
  const m = craft(0, LIVE, 0, 0);
  m.mem8[SHOT_RECORDS + RECORD_STRIDE + STATE] = LIVE;
  return m;
}

const EXTRAS = [craftUnstaged, craftReachableTarget, craftTwoShotsOnOne];

function sweepCaught(candidate) {
  let caught = 0;
  sweep((era, state, axis, offset) => {
    if (unitDiff(candidate, craft(era, state, axis, offset))) caught++;
  });
  for (const make of EXTRAS) if (unitDiff(candidate, make())) caught++;
  return caught;
}

/** True when the crafted entry ends with the standing object destroyed. */
function hits(era, state, axis, offset) {
  const m = craft(era, state, axis, offset);
  sweepShotsOverFiveCraftThenMotherShip(m);
  return m.mem8[MOTHER_SHIP_STATE] === DESTROYED;
}

// ── twins ───────────────────────────────────────────────────────────────────────────────

const within = (a, b, reach, span) => (((a - b) & 0xff) + reach) % 256 < span;
const nextRecord = (cursor) => (cursor & 0xff00) | ((cursor + RECORD_STRIDE) & 0xff);

function run(m, o) {
  const opt = {
    firstSweep: true, secondSweep: true, stage: true, checkState: true, swapAxes: false,
    stopAtFirst: false, wideEras: WIDE_ERAS, ...o,
  };
  const { mem8, mem16 } = m;
  if (opt.stage) {
    mem16[TARGET_RECORD_CURSOR] = TARGET_RECORDS;
    mem16[TARGET_ENTRY_CURSOR] = TARGET_ENTRIES;
  }
  if (opt.firstSweep) {
    destroyTargetsHitByShots(
      m, SHOT_RECORDS, TARGET_ENTRIES, TARGET_RECORDS,
      TARGETS, TARGETS, SHOTS, TARGET_REACH, TARGET_SPAN,
    );
  }
  if (!opt.secondSweep) return;
  const wide = opt.wideEras.includes(mem8[ERA_INDEX]);
  const reach = wide ? WIDE_REACH : NARROW_REACH;
  const span = wide ? WIDE_SPAN : NARROW_SPAN;
  if (opt.checkState && mem8[MOTHER_SHIP_STATE] !== LIVE) return;
  let shot = SHOT_RECORDS;
  for (let left = SHOTS; left !== 0; left--) {
    const firstOk = opt.swapAxes
      ? within(mem8[STANDING_FIRST_AXIS], mem8[shot + SHOT_FIRST_AXIS],
        SECOND_AXIS_REACH, SECOND_AXIS_SPAN)
      : within(mem8[STANDING_FIRST_AXIS], mem8[shot + SHOT_FIRST_AXIS], reach, span);
    const secondOk = opt.swapAxes
      ? within(mem8[STANDING_SECOND_AXIS], mem8[shot + SHOT_SECOND_AXIS], reach, span)
      : within(mem8[STANDING_SECOND_AXIS], mem8[shot + SHOT_SECOND_AXIS],
        SECOND_AXIS_REACH, SECOND_AXIS_SPAN);
    if (mem8[shot + STATE] === LIVE && firstOk && secondOk) {
      mem8[MOTHER_SHIP_STATE] = DESTROYED;
      mem8[shot + STATE] = DESTROYED;
      postChainedHitScore(m);
      if (opt.stopAtFirst) return;
    }
    shot = nextRecord(shot);
  }
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: skips the shared first sweep entirely. */
function brokenNoFirstSweep(m) {
  run(m, { firstSweep: false });
}

/** BUG: runs the first sweep and stops. */
function brokenNoSecondSweep(m) {
  run(m, { secondSweep: false });
}

/** BUG: leaves the two reload cells holding whatever they held. */
function brokenNoStaging(m) {
  run(m, { stage: false });
}

/** BUG: sweeps the standing object even when it is not live. */
function brokenIgnoresState(m) {
  run(m, { checkState: false });
}

/** BUG: the two axes get each other's box. */
function brokenSwapsAxes(m) {
  run(m, { swapAxes: true });
}

/** BUG: the era split is wrong, so the middle eras get the wide box. */
function brokenEraSplit(m) {
  run(m, { wideEras: [0, 1, 4] });
}

/** BUG: stops at the first shot that reaches, so a second one in the same frame is not paid. */
function brokenStopsAtFirst(m) {
  run(m, { stopAtFirst: true });
}

/** Each twin's exact catch count over the crafted sweep. Measured; a move is a finding. */
const TWINS = [
  ["no-op", brokenNoOp, 216],
  ["no-first-sweep", brokenNoFirstSweep, 1],
  ["no-second-sweep", brokenNoSecondSweep, 215],
  ["no-cursor-staging", brokenNoStaging, 1],
  ["ignores-the-standing-state", brokenIgnoresState, 426],
  ["swaps-axes", brokenSwapsAxes, 142],
  ["wrong-era-split", brokenEraSplit, 4],
  ["stops-at-the-first-hit", brokenStopsAtFirst, 1],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: sweepShotsOverFiveCraftThenMotherShip == oracle outside the scratch window", { skip }, () => {
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  sweepShotsOverFiveCraftThenMotherShip(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  console.log(`  EQUAL: sp=${hex4(sp)}; identical outside ${SCRATCH_BYTES} scratch bytes`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft(0, LIVE, 0, 0));
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: a bounded register set, and nothing else", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  sweepShotsOverFiveCraftThenMotherShip(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")}`);
});

test("CORPUS: every dispatch of a real attract session replays identically", { skip }, () => {
  const r = replay(sweepShotsOverFiveCraftThenMotherShip);
  assert.equal(r.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(r.caught, 0, "the rewrite diverged on a real dispatch");
  console.log(
    `  CORPUS: ${r.dispatches} dispatches, eras ${[...r.eras]}, ` +
      `standing states ${[...r.standing]}`,
  );
});

test("THE CURSOR CELLS ARE STAGED before the shared sweep reads them", { skip }, () => {
  const m = craft(0, LIVE, 0, 0);
  m.mem16[TARGET_RECORD_CURSOR] = 0x0000;
  m.mem16[TARGET_ENTRY_CURSOR] = 0x0000;
  sweepShotsOverFiveCraftThenMotherShip(m);
  assert.equal(m.mem16[TARGET_RECORD_CURSOR], TARGET_RECORDS, "the record cursor");
  assert.equal(m.mem16[TARGET_ENTRY_CURSOR], TARGET_ENTRIES, "the entry cursor");
  console.log(`  STAGED: ${hex4(TARGET_RECORD_CURSOR)} and ${hex4(TARGET_ENTRY_CURSOR)} rewritten`);
});

test("CRAFTED: the whole era x state x offset grid behaves as the oracle", { skip }, () => {
  assert.equal(sweepCaught(sweepShotsOverFiveCraftThenMotherShip), 0, "the rewrite diverged somewhere in the crafted space");
  let hitCount = 0;
  let missCount = 0;
  sweep((era, state, axis, offset) => (hits(era, state, axis, offset) ? hitCount++ : missCount++));
  assert.ok(hitCount > 0, "vacuous: the crafted grid never produces a hit");
  assert.ok(missCount > 0, "vacuous: the crafted grid never produces a miss");
  console.log(
    `  CRAFTED: ${SWEEP_SIZE} entries identical — a grid of ${hitCount + missCount} ` +
      `(${hitCount} hit, ${missCount} missed) plus ${EXTRA_STATES} further states`,
  );
});

test("THE BOX IS ERA-KEYED: the first axis reaches further in the first and last era", { skip }, () => {
  const widthByEra = ERAS.map((era) =>
    OFFSETS.filter((offset) => hits(era, LIVE, 0, offset)).length);
  const wide = widthByEra.filter((_unused, era) => WIDE_ERAS.includes(era));
  const narrow = widthByEra.filter((_unused, era) => !WIDE_ERAS.includes(era));
  assert.equal(new Set(wide).size, 1, "the wide eras must agree with each other");
  assert.equal(new Set(narrow).size, 1, "the narrow eras must agree with each other");
  assert.ok(wide[0] > narrow[0], "the wide eras must reach further than the narrow ones");

  const second = ERAS.map((era) => OFFSETS.filter((offset) => hits(era, LIVE, 1, offset)).length);
  assert.equal(new Set(second).size, 1, "the second axis must NOT depend on the era");
  console.log(`  ERA-KEYED: first axis ${wide[0]} wide / ${narrow[0]} narrow; second ${second[0]}`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's catch count moved`);
    assert.ok(craftedCaught > 0, `the ${label} twin is caught nowhere at all`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${SWEEP_SIZE} crafted entries`);
  });
}

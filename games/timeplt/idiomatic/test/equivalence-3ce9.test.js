// SPDX-License-Identifier: GPL-3.0-only
/**
 * mirrorTwoTileObjectByHeading — memory-equivalent to the frozen oracle at ROM 0x3CE9.
 *
 * GATE: strict unit-capture on the undriven attract run, every captured dispatch replayed, an
 *   exhaustive cross of the heading against the stage cell and the alternating counter bit, a
 *   whole-machine replay, and teeth.
 *   1. EQUAL at the real dispatch — the whole dump identical, stack scratch included.
 *   2. VACUITY, MEASURED — a no-op is invisible at ABOUT HALF the real dispatches, because the
 *      four bytes often already hold what this writes. The exact count is asserted.
 *   3. EXCLUDED, deliberately, bounded by a declared set — a register outside it diverging fails
 *      the arm, and a rewrite that diverges on fewer of them passes.
 *   4. CORPUS — every dispatch the attract run produces, with the shapes it presented.
 *   5. EXHAUSTIVE — 256 headings against every stage value and both counter bits.
 *   6. THE SWAP HAPPENS AT THE HALF TURN — the heading at which the two shape codes change ends is
 *      measured over the whole circle and asserted to be exactly one boundary pair, so "the short
 *      way round" is checked and not described.
 *   7. WHOLE-MACHINE — the session replayed with the rewrite wired through a measured shim.
 *   8. TEETH — eight twins, each caught on an exact declared count. One is INVISIBLE at the
 *      real dispatch, whose heading lies where the right boundary and a wrong one agree.
 *
 * HOLE: the corpus presents two headings and four stage values, so almost everything about the
 *   heading is exercised by the crafted cross rather than by real data.
 * HOLE: nothing here says the two shape codes ARE the two halves of one object. That is a claim
 *   about the picture, and no arm in this file renders anything.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3ce9.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { mirrorTwoTileObjectByHeading } from "../mirrorTwoTileObjectByHeading.js";
import { loc_3ce9 as oracle } from "../../translated/loc_3ce9.js";
import {
  firstStateDiff,
  unitEquivalence,
  wholeMachineEquivalence,
} from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { FRAME_TICK, BOMBER_HITS_TO_ABSORB } from "../names.js";

const TARGET = 0x3ce9;

const ALTERNATE_BIT = 0x02;
const LAST_STAGE = 3;
const SHAPES_PER_STAGE = 4;
const FIRST_SHAPE = 0xa0;

const HEADING = 2;
const FIRST_ENTRY_SHAPE = 1;
const SECOND_ENTRY_SHAPE = 3;
const FIRST_ENTRY_ATTRIBUTE = 0x30;
const SECOND_ENTRY_ATTRIBUTE = 0x32;

const HALF_TURN = 0x80;
const QUARTER_TURN = 0x40;
const ATTRIBUTE_FORWARD = 0xed;
const ATTRIBUTE_REVERSED = 0x6d;

const MOVED = ["a", "f", "b", "c", "sp"];
const FRAMES = 2000;
const RET_TSTATES = 10;

/** Measured over the corpus below; a move is a finding. */
const DISPATCHES = 272;
const NO_OP_SEEN = 142;

const HEADINGS = Array.from({ length: 256 }, (_unused, h) => h);
const STAGES = [0, 1, 2, 3, 4, 0xff];
const ALTERNATES = [0, ALTERNATE_BIT];
const SWEEP_SIZE = HEADINGS.length * STAGES.length * ALTERNATES.length;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

const factory = (overrides) => makeMachine(overrides, { tape: [] });

// ── the entry ───────────────────────────────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(factory, TARGET, oracle, (m) => {
    if (entry === null) entry = m.clone();
    return candidate(m);
  }, { maxFrames: FRAMES });
}

function entryState() {
  if (entry === null) gate(mirrorTwoTileObjectByHeading);
  return entry;
}

function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
}

const caught = (candidate, machine) => unitDiff(candidate, machine) !== null;
const shapeOf = (m) =>
  `${m.mem8[BOMBER_HITS_TO_ABSORB]}/${m.mem8[m.regs.ix + HEADING]}/${m.mem8[FRAME_TICK] & ALTERNATE_BIT}`;

// ── the corpus ──────────────────────────────────────────────────────────────────────────

let corpus = null;
function captureCorpus() {
  if (corpus) return corpus;
  const entries = [];
  const shapes = new Set();
  let noOpSeen = 0;
  const m = factory(new Map([[TARGET, (mm) => {
    entries.push(mm.clone());
    shapes.add(shapeOf(mm));
    if (caught(() => {}, mm)) noOpSeen++;
    return oracle(mm);
  }]]));
  const frames = m.runFrames(FRAMES);
  assert.equal(m.stoppedBy, null, `corpus run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, FRAMES, "corpus run ran short");
  corpus = { entries, shapes, noOpSeen };
  return corpus;
}

/** A real captured machine forced onto one (heading, stage, counter bit). */
function craft(heading, stage, alternate) {
  const m = entryState().clone();
  m.mem8[m.regs.ix + HEADING] = heading;
  m.mem8[BOMBER_HITS_TO_ABSORB] = stage;
  m.mem8[FRAME_TICK] = (m.mem8[FRAME_TICK] & ~ALTERNATE_BIT) | alternate;
  return m;
}

function sweepCaught(candidate) {
  let n = 0;
  for (const h of HEADINGS) {
    for (const s of STAGES) for (const a of ALTERNATES) if (caught(candidate, craft(h, s, a))) n++;
  }
  return n;
}

// ── the shim, measured rather than asserted ─────────────────────────────────────────────

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

const replay = (candidate) =>
  wholeMachineEquivalence(factory, FRAMES, new Map([[TARGET, hosted(candidate)]]));

// ── the twins ───────────────────────────────────────────────────────────────────────────

const shapeFor = (m) =>
  (FIRST_SHAPE +
    SHAPES_PER_STAGE * ((LAST_STAGE - m.mem8[BOMBER_HITS_TO_ABSORB]) & 0xff) +
    (m.mem8[FRAME_TICK] & ALTERNATE_BIT)) &
  0xff;
const reversedAt = (m) => ((m.mem8[m.regs.ix + HEADING] + QUARTER_TURN) & 0xff) < HALF_TURN;

function place(m, lower, upper, attribute) {
  m.mem8[m.regs.iy + lower] = shapeFor(m);
  m.mem8[m.regs.iy + upper] = shapeFor(m) + 1;
  m.mem8[m.regs.iy + FIRST_ENTRY_ATTRIBUTE] = attribute;
  m.mem8[m.regs.iy + SECOND_ENTRY_ATTRIBUTE] = attribute;
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the two halves never swap ends, so half the circle is drawn back to front. */
function brokenNoSwap(m) {
  place(m, FIRST_ENTRY_SHAPE, SECOND_ENTRY_SHAPE, reversedAt(m) ? ATTRIBUTE_REVERSED : ATTRIBUTE_FORWARD);
}

/** BUG: the attribute never changes, so the halves swap but the shapes are not mirrored with them. */
function brokenNoAttributeSwap(m) {
  const reversed = reversedAt(m);
  place(m, reversed ? SECOND_ENTRY_SHAPE : FIRST_ENTRY_SHAPE,
    reversed ? FIRST_ENTRY_SHAPE : SECOND_ENTRY_SHAPE, ATTRIBUTE_FORWARD);
}

/** BUG: the swap boundary is a quarter turn out. */
function brokenBoundaryOffByQuarter(m) {
  const reversed = m.mem8[m.regs.ix + HEADING] < HALF_TURN;
  place(m, reversed ? SECOND_ENTRY_SHAPE : FIRST_ENTRY_SHAPE,
    reversed ? FIRST_ENTRY_SHAPE : SECOND_ENTRY_SHAPE,
    reversed ? ATTRIBUTE_REVERSED : ATTRIBUTE_FORWARD);
}

/** BUG: the stage counts upward, so a big object is drawn small and the other way round. */
function brokenStageNotInverted(m) {
  const reversed = reversedAt(m);
  const shape = (FIRST_SHAPE + SHAPES_PER_STAGE * m.mem8[BOMBER_HITS_TO_ABSORB] +
    (m.mem8[FRAME_TICK] & ALTERNATE_BIT)) & 0xff;
  m.mem8[m.regs.iy + (reversed ? SECOND_ENTRY_SHAPE : FIRST_ENTRY_SHAPE)] = shape;
  m.mem8[m.regs.iy + (reversed ? FIRST_ENTRY_SHAPE : SECOND_ENTRY_SHAPE)] = shape + 1;
  const attribute = reversed ? ATTRIBUTE_REVERSED : ATTRIBUTE_FORWARD;
  m.mem8[m.regs.iy + FIRST_ENTRY_ATTRIBUTE] = attribute;
  m.mem8[m.regs.iy + SECOND_ENTRY_ATTRIBUTE] = attribute;
}

/** BUG: the object never flickers, so one of its two frames is never shown. */
function brokenNoAlternate(m) {
  const reversed = reversedAt(m);
  const shape = (FIRST_SHAPE + SHAPES_PER_STAGE * ((LAST_STAGE - m.mem8[BOMBER_HITS_TO_ABSORB]) & 0xff)) & 0xff;
  m.mem8[m.regs.iy + (reversed ? SECOND_ENTRY_SHAPE : FIRST_ENTRY_SHAPE)] = shape;
  m.mem8[m.regs.iy + (reversed ? FIRST_ENTRY_SHAPE : SECOND_ENTRY_SHAPE)] = shape + 1;
  const attribute = reversed ? ATTRIBUTE_REVERSED : ATTRIBUTE_FORWARD;
  m.mem8[m.regs.iy + FIRST_ENTRY_ATTRIBUTE] = attribute;
  m.mem8[m.regs.iy + SECOND_ENTRY_ATTRIBUTE] = attribute;
}

/** BUG: both halves take the same shape code, so the object is two of its own left half. */
function brokenSameShapeTwice(m) {
  const reversed = reversedAt(m);
  m.mem8[m.regs.iy + FIRST_ENTRY_SHAPE] = shapeFor(m);
  m.mem8[m.regs.iy + SECOND_ENTRY_SHAPE] = shapeFor(m);
  const attribute = reversed ? ATTRIBUTE_REVERSED : ATTRIBUTE_FORWARD;
  m.mem8[m.regs.iy + FIRST_ENTRY_ATTRIBUTE] = attribute;
  m.mem8[m.regs.iy + SECOND_ENTRY_ATTRIBUTE] = attribute;
}

/** BUG: only one of the two entries gets its attribute, so the halves disagree. */
function brokenOneAttribute(m) {
  const reversed = reversedAt(m);
  m.mem8[m.regs.iy + (reversed ? SECOND_ENTRY_SHAPE : FIRST_ENTRY_SHAPE)] = shapeFor(m);
  m.mem8[m.regs.iy + (reversed ? FIRST_ENTRY_SHAPE : SECOND_ENTRY_SHAPE)] = shapeFor(m) + 1;
  m.mem8[m.regs.iy + FIRST_ENTRY_ATTRIBUTE] = reversed ? ATTRIBUTE_REVERSED : ATTRIBUTE_FORWARD;
}

/** Per twin: exact catch count over the crafted cross, and its verdict at the real dispatch. */
const TWINS = [
  ["no-op", brokenNoOp, 3072, true],
  ["no-swap", brokenNoSwap, 1536, true],
  ["no-attribute-swap", brokenNoAttributeSwap, 1536, true],
  ["boundary-off-by-quarter", brokenBoundaryOffByQuarter, 1536, false],
  ["stage-not-inverted", brokenStageNotInverted, 3072, true],
  ["no-alternate", brokenNoAlternate, 1536, true],
  ["same-shape-twice", brokenSameShapeTwice, 3072, true],
  ["one-attribute", brokenOneAttribute, 3072, true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: mirrorTwoTileObjectByHeading == oracle on the whole dump", { skip }, () => {
  const r = gate(mirrorTwoTileObjectByHeading);
  assert.notEqual(entry, null, "vacuous: the attract run never reached the routine");
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  console.log(`  EQUAL: entry stage/heading/alternate ${shapeOf(entryState())}; identical`);
});

test("VACUITY, MEASURED: a no-op is invisible at about half the real dispatches", { skip }, () => {
  const { entries, noOpSeen } = captureCorpus();
  assert.equal(noOpSeen, NO_OP_SEEN, "the fraction of dispatches a no-op is visible at moved");
  assert.ok(noOpSeen > 0, "a no-op is invisible at EVERY real dispatch, so RAM gates nothing here");
  assert.ok(noOpSeen < entries.length, "a no-op is now visible everywhere, so the hole has closed");
  console.log(`  VACUITY: a no-op shows at ${noOpSeen} of ${entries.length} real dispatches`);
});

test("EXCLUDED, deliberately: scratch registers, the stack pointer and pc", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  mirrorTwoTileObjectByHeading(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !MOVED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: ${MOVED.join(", ")} and pc`);
});

test("CORPUS: every captured dispatch replays identically", { skip }, () => {
  const { entries, shapes } = captureCorpus();
  assert.equal(entries.length, DISPATCHES, "the dispatch count moved");
  for (const captured of entries) {
    assert.equal(unitDiff(mirrorTwoTileObjectByHeading, captured), null, "a captured dispatch diverged");
  }
  console.log(`  CORPUS: ${entries.length} dispatches over ${shapes.size} distinct shapes`);
});

test("EXHAUSTIVE: every heading against every stage and both counter bits", { skip }, () => {
  for (const h of HEADINGS) {
    for (const s of STAGES) {
      for (const a of ALTERNATES) {
        const d = unitDiff(mirrorTwoTileObjectByHeading, craft(h, s, a));
        assert.equal(d, null, `heading ${h} stage ${s} alternate ${a}: ${show(d)}`);
      }
    }
  }
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} combinations identical`);
});

test("THE SWAP HAPPENS AT THE HALF TURN, once round the circle", { skip }, () => {
  const lower = HEADINGS.map((h) => {
    const m = craft(h, 1, 0);
    mirrorTwoTileObjectByHeading(m);
    return m.mem8[m.regs.iy + FIRST_ENTRY_SHAPE] < m.mem8[m.regs.iy + SECOND_ENTRY_SHAPE];
  });
  const boundaries = HEADINGS.filter((h) => lower[h] !== lower[(h + 255) % 256]);
  assert.deepEqual(
    boundaries,
    [QUARTER_TURN, (QUARTER_TURN + HALF_TURN) % 256],
    "the ends swap somewhere other than the two antipodal headings a half turn apart",
  );
  console.log(`  SWAP: the two halves change ends at ${boundaries.map((h) => hex4(h)).join(" and ")}`);
});

test("WHOLE-MACHINE: the session is byte-identical with the rewrite wired", { skip }, () => {
  const w = replay(mirrorTwoTileObjectByHeading);
  assert.ok(w.invocations.get(TARGET) > 0, "vacuous: the override never dispatched");
  assert.equal(w.framesCompared, FRAMES, "the replay ran short");
  assert.equal(w.equal, true, `forked at frame ${w.frame} on ${hex4(w.addr ?? 0)}`);
  console.log(`  WHOLE-MACHINE: ${w.framesCompared} frames, ${w.invocations.get(TARGET)} dispatches`);
});

test("TEETH: removing the shim's return kills the run, so the shim is load-bearing", { skip }, () => {
  let died = null;
  try {
    const w = wholeMachineEquivalence(factory, FRAMES, new Map([[TARGET, mirrorTwoTileObjectByHeading]]));
    died = w.equal ? null : "forked";
  } catch (e) {
    died = String(e).slice(0, 80);
  }
  assert.notEqual(died, null, "the unshimmed rewrite ran clean, so the shim proves nothing");
  console.log(`  TEETH/shim: the unshimmed rewrite dies — ${died}`);
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

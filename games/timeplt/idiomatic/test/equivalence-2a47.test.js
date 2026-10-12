// SPDX-License-Identifier: GPL-3.0-only
/**
 * refreshSecondEraSpriteFromHeading — memory-equivalent to the frozen oracle at ROM 0x2A47.
 *
 * GATE: strict unit-capture replayed over every dispatch of an undriven attract session, plus an
 *   exhaustive crafted sweep over the heading and both halves of the shape-bank flip, plus teeth.
 *
 * What it exercises, with the holes stated:
 *   1. EQUAL at the real dispatch — identical outside a four-byte scratch window.
 *   2. THE SCRATCH WINDOW IS THE ONE EXCLUSION, pinned to [SP-4, SP): the oracle brackets its
 *      lookup with a pushed return address and that lookup pushes again. Every arm walks the whole
 *      dump and asserts nothing escapes the window.
 *   3. NOT VACUOUS — a candidate that does nothing fails the same comparison, on a real cell.
 *   4. EXCLUDED, deliberately — a declared set that BOUNDS which registers may differ: nothing
 *      outside it may move, and a rewrite that moves fewer of them still passes. The two bytes the
 *      lookup leaves behind are NOT in it: the rewrite reproduces them.
 *   5. CORPUS — every dispatch of a 2000-frame attract session replayed on a clone.
 *   6. EXHAUSTIVE — all 256 headings crossed with both halves of the bank flip, crafted onto the
 *      real entry state, which is the only arm that covers the whole circle.
 *   7. THE BIASES ARE MEASURED, not asserted about: both cells are read back and compared against
 *      the pair the lookup produced on the same state, so a wrong bias cannot hide.
 *   8. TEETH — six twins with exact catch counts over the crafted sweep.
 *
 * HOLE: nothing here says which object class this entry serves, nor what the tint it selects looks
 * like. The gate fixes the two biases and the two destination cells.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2a47.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { refreshSecondEraSpriteFromHeading } from "../refreshSecondEraSpriteFromHeading.js";
import { spriteForHeading } from "../spriteForHeading.js";
import { loc_2a47 as oracle } from "../../translated/loc_2a47.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { FRAME_TICK } from "../names.js";

const TARGET = 0x2a47;
const FRAMES = 2000;
const DISPATCHES = 2407;

const HEADING = 2;
const SHAPE = 1;
const ATTRIBUTE = 0x30;
const SHAPE_BIAS = 16;
const ATTRIBUTE_BIAS = 53;
const ALTERNATE_POSE_BIT = 2;

const SCRATCH_BYTES = 4;
const EXCLUDED = ["a", "f", "d", "e", "h", "l", "sp"];

const HEADINGS = Array.from({ length: 256 }, (_unused, i) => i);
const POSES = [0x00, ALTERNATE_POSE_BIT];
const SWEEP_SIZE = HEADINGS.length * POSES.length;

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
  const stray = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (stray) return stray;
  if (a.regs.b !== b.regs.b) return { addr: null, a: a.regs.b, b: b.regs.b };
  if (a.regs.c !== b.regs.c) return { addr: null, a: a.regs.c, b: b.regs.c };
  return null;
}

let entry = null;

function replay(candidate) {
  let dispatches = 0;
  let caught = 0;
  const headings = new Set();
  const host = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    if (entry === null) entry = mm.clone();
    headings.add(mm.mem8[(mm.regs.ix + HEADING) & 0xffff]);
    const sp = mm.regs.sp;
    const b = mm.clone();
    candidate(b);
    const r = oracle(mm);
    if (allDiffs(mm, b).some((d) => !inScratch(d.addr, sp))) caught++;
    else if (mm.regs.b !== b.regs.b || mm.regs.c !== b.regs.c) caught++;
    return r;
  }]]), { tape: [] });
  const frames = host.runFrames(FRAMES);
  assert.equal(host.stoppedBy, null, `session stopped early: ${host.stoppedBy}`);
  assert.equal(frames.length, FRAMES, "session ran short");
  return { dispatches, caught, headings };
}

function entryState() {
  if (entry === null) replay(refreshSecondEraSpriteFromHeading);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  return entry;
}

/** A real captured machine with the heading and the bank flip forced. */
function craft(heading, half) {
  const m = entryState().clone();
  m.mem8[(m.regs.ix + HEADING) & 0xffff] = heading;
  m.mem8[FRAME_TICK] = (m.mem8[FRAME_TICK] & ~ALTERNATE_POSE_BIT) | half;
  return m;
}

function sweepCaught(candidate) {
  let caught = 0;
  for (const half of POSES) {
    for (const heading of HEADINGS) if (unitDiff(candidate, craft(heading, half))) caught++;
  }
  return caught;
}

// ── twins ───────────────────────────────────────────────────────────────────────────────

function place(m, shapeBias, attributeBias, both) {
  const { mem8, regs } = m;
  const sprite = regs.iy;
  spriteForHeading(m, regs.ix);
  mem8[sprite + ATTRIBUTE] = regs.c + attributeBias;
  if (both) mem8[sprite + SHAPE] = regs.b + shapeBias;
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: stores the lookup's pair unshifted. */
function brokenNoBias(m) {
  place(m, 0, 0, true);
}

/** BUG: the two biases are applied to the wrong halves of the pair. */
function brokenSwapsBiases(m) {
  place(m, ATTRIBUTE_BIAS, SHAPE_BIAS, true);
}

/** BUG: the shape bias is one out. */
function brokenShapeBias(m) {
  place(m, SHAPE_BIAS - 1, ATTRIBUTE_BIAS, true);
}

/** BUG: the tint bias is one out. */
function brokenAttributeBias(m) {
  place(m, SHAPE_BIAS, ATTRIBUTE_BIAS - 1, true);
}

/** BUG: writes the tint and leaves the shape standing. */
function brokenAttributeOnly(m) {
  place(m, SHAPE_BIAS, ATTRIBUTE_BIAS, false);
}

/** Each twin's exact catch count over the crafted sweep. Measured; a move is a finding. */
const TWINS = [
  ["no-op", brokenNoOp, 512],
  ["no-bias", brokenNoBias, 512],
  ["swaps-biases", brokenSwapsBiases, 512],
  ["shape-bias-off-by-one", brokenShapeBias, 512],
  ["tint-bias-off-by-one", brokenAttributeBias, 512],
  ["tint-only", brokenAttributeOnly, 512],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: refreshSecondEraSpriteFromHeading == oracle outside the scratch window", { skip }, () => {
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  refreshSecondEraSpriteFromHeading(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(a.regs.b, b.regs.b, "the shape the lookup left behind");
  assert.equal(a.regs.c, b.regs.c, "the byte beside it");
  console.log(`  EQUAL: sp=${hex4(sp)}; identical outside ${SCRATCH_BYTES} scratch bytes`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft(0x30, 0));
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: a bounded register set, and nothing else", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  refreshSecondEraSpriteFromHeading(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  assert.ok(!EXCLUDED.includes("b") && !EXCLUDED.includes("c"), "the lookup's pair must agree");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")}`);
});

test("CORPUS: every dispatch of a real attract session replays identically", { skip }, () => {
  const r = replay(refreshSecondEraSpriteFromHeading);
  assert.equal(r.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(r.caught, 0, "the rewrite diverged on a real dispatch");
  assert.ok(r.headings.size > 1, "vacuous: the session presents one heading only");
  console.log(`  CORPUS: ${r.dispatches} dispatches, ${r.headings.size} distinct headings`);
});

test("EXHAUSTIVE: every heading against both halves of the bank flip", { skip }, () => {
  assert.equal(sweepCaught(refreshSecondEraSpriteFromHeading), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} heading x half comparisons identical`);
});

test("THE BIASES LAND: both cells sit a fixed distance from the lookup's pair", { skip }, () => {
  const shapes = new Set();
  for (const heading of HEADINGS) {
    const m = craft(heading, 0);
    const probe = m.clone();
    spriteForHeading(probe, probe.regs.ix);
    refreshSecondEraSpriteFromHeading(m);
    assert.equal(m.mem8[m.regs.iy + SHAPE], (probe.regs.b + SHAPE_BIAS) & 0xff, "shape bias");
    assert.equal(m.mem8[m.regs.iy + ATTRIBUTE], (probe.regs.c + ATTRIBUTE_BIAS) & 0xff, "tint bias");
    shapes.add(m.mem8[m.regs.iy + SHAPE]);
  }
  assert.ok(shapes.size > 1, "vacuous: every heading produced the same shape");
  console.log(`  BIASES: shape +${SHAPE_BIAS}, tint +${ATTRIBUTE_BIAS}; ${shapes.size} shapes seen`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's catch count moved`);
    assert.ok(craftedCaught > 0, `the ${label} twin is caught nowhere at all`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${SWEEP_SIZE} crafted entries`);
  });
}

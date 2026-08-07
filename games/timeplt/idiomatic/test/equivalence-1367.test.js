// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1367 — memory-equivalent to the frozen oracle at ROM 0x1367.
 *
 * GATE: crafted-entry, because the strict one CANNOT run here. Neither the shared coin -> start
 *   tape nor an undriven session dispatches 0x1367 in two thousand frames, so unitEquivalence
 *   throws "never entered" and the first arm ASSERTS that throw rather than quietly raising the
 *   frame budget. The entry is therefore BUILT rather than captured: a real machine, cloned at
 *   the end of the tape's session, with only the cells this routine reads forced.
 *
 *   ONE EXCLUSION, the dead stack scratch: on the tick that asks for a sound the frozen routine
 *   calls out, and that call pushes further, so up to eight bytes below the entry stack pointer
 *   can hold return slots the rewrite never writes. The window is exactly [SP-8, SP) and every
 *   arm PINS it.
 *
 * What it exercises, holes stated:
 *   1. UNREACHED — measured on both sessions, not assumed.
 *   2. NOT VACUOUS — an empty candidate FAILS the crafted comparison.
 *   3. EXCLUDED — the register divergence pinned to a measured set.
 *   4. EXHAUSTIVE — the routine reads two cells and writes three, and the sweep covers the WHOLE
 *      of that space: every one of 256 tick values against five priors of the attribute byte.
 *      The one tick that asks for a sound is in there, and so is the wrap of the tick counter.
 *   5. THE MIRRORING BITS SURVIVE — asserted directly, from an attribute byte with both of them
 *      set, because a rewrite that wrote the colour whole would still pass every arm above on a
 *      prior where those bits are clear.
 *   6. TEETH — seven twins, each caught on an exact count of crafted entries. The two about the
 *      sound score in the low tens where the rest score in the hundreds, and that IS the shape of
 *      the routine: only the tick that asks for the sound can tell those two from the rewrite,
 *      and the sweep presents it once per attribute prior.
 *
 * HOLE: one backdrop. Every cell but the two read ones is what the session left. The sound the
 * one special tick asks for is posted through a ring whose state comes from that backdrop, so a
 * congested ring is not covered — the frozen routine and the rewrite reach the same posting code,
 * which is why that is a coverage hole and not a correctness one.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-1367.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_1367 } from "../loc_1367.js";
import { loc_5811 } from "../loc_5811.js";
import { loc_1367 as oracle } from "../../translated/loc_1367.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8 } from "../../../../core/int.js";

const TARGET = 0x1367;
const skip = romsPresent() ? false : "ROM images are gitignored and absent";

const SCRATCH_BYTES = 8;
const ANIMATION_STEP = 0xa9f0;
const ANIMATION_TICK = 0xa9f1;
const SPRITE_ATTRIBUTE = 0xaa40;
const MIRROR_BITS = 0xc0;
const ALTERNATING_BIT = 0x01;
const FIRST_COLOUR = 62;
const SECOND_COLOUR = 0;
const SOUND_AT_TICK = 8;
const NEXT_STEP = 1;

const CORPUS_FRAMES = 2000;
const TAPES = [["shared", {}], ["attract", { tape: [] }]];
const EXCLUDED = ["a", "f", "b", "sp"];

/** Attribute priors: both mirroring bits set, both clear, and mixtures. */
const ATTRIBUTES = [0x00, 0xff, 0xc0, 0x3f, 0x81];
/** A point that runs the whole body, sound included. */
const LIVE_POINT = [SOUND_AT_TICK, 0xff];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: frozen=${d.a} candidate=${d.b}` : "identical");

// ── the session, and the entry built off it ─────────────────────────────────────────────

let session = null;
function sessionRun() {
  if (session) return session;
  let host = null;
  let threw = null;
  try {
    unitEquivalence((overrides) => (host = makeMachine(overrides)), TARGET, oracle, loc_1367, {
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

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, a: "survived", b: String(e).slice(0, 40) };
  }
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

function craft([tick, attribute]) {
  const m = pristine().clone();
  m.mem8[ANIMATION_TICK] = tick;
  m.mem8[SPRITE_ATTRIBUTE] = attribute;
  return m;
}

const POINTS = [];
for (let tick = 0; tick < 256; tick++) for (const a of ATTRIBUTES) POINTS.push([tick, a]);

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
  return dispatches;
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

function frame(m, {
  soundTick = SOUND_AT_TICK, mask = MIRROR_BITS, bit = ALTERNATING_BIT,
  first = FIRST_COLOUR, second = SECOND_COLOUR, stepTick = true, sound = true,
} = {}) {
  const { mem8 } = m;
  if (mem8[ANIMATION_TICK] === soundTick) {
    mem8[ANIMATION_STEP] = NEXT_STEP;
    if (sound) loc_5811(m);
  }
  const colour = (mem8[ANIMATION_TICK] & bit) === 0 ? first : second;
  mem8[SPRITE_ATTRIBUTE] = (mem8[SPRITE_ATTRIBUTE] & mask) + colour;
  if (stepTick) mem8[ANIMATION_TICK] = u8(mem8[ANIMATION_TICK] + 1);
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the colour is written whole, so the mirroring bits are wiped. */
function brokenWipesTheMirrorBits(m) {
  frame(m, { mask: 0x00 });
}

/** BUG: the two colours swap, so the animation runs in antiphase. */
function brokenSwapsTheColours(m) {
  frame(m, { first: SECOND_COLOUR, second: FIRST_COLOUR });
}

/** BUG: the tick counter is never stepped, so the animation stands still. */
function brokenDoesNotStepTheTick(m) {
  frame(m, { stepTick: false });
}

/** BUG: the step cell is moved on one tick early. */
function brokenSoundOneTickEarly(m) {
  frame(m, { soundTick: SOUND_AT_TICK - 1 });
}

/** BUG: nothing is asked for on the tick that should ask. */
function brokenAsksForNoSound(m) {
  frame(m, { sound: false });
}

/** BUG: the colour alternates on the wrong bit, so it holds twice as long. */
function brokenWrongAlternatingBit(m) {
  frame(m, { bit: 0x02 });
}

const TWINS = [
  ["no-op", brokenNoOp, 1280],
  ["wipes-the-mirror-bits", brokenWipesTheMirrorBits, 768],
  ["swaps-the-colours", brokenSwapsTheColours, 1280],
  ["does-not-step-the-tick", brokenDoesNotStepTheTick, 1280],
  ["sound-one-tick-early", brokenSoundOneTickEarly, 10],
  ["asks-for-no-sound", brokenAsksForNoSound, 5],
  ["wrong-alternating-bit", brokenWrongAlternatingBit, 640],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: the strict gate CANNOT run here, and both sessions confirm it", { skip }, () => {
  assert.notEqual(sessionRun().threw, null, "the shared tape now reaches this routine, so the " +
    "strict unit-capture gate is available and this file should use it");
  assert.match(String(sessionRun().threw), /never entered/, "the harness failed for another reason");
  for (const [label, opts] of TAPES) {
    assert.equal(dispatchCount(opts), 0, `the ${label} session now dispatches this routine`);
  }
  console.log(
    `  UNREACHED: neither of ${TAPES.length} sessions of ${CORPUS_FRAMES} frames dispatches it; ` +
      `the entry is a real machine at sp=${hex4(pristine().regs.sp)} with its two inputs forced`,
  );
});

test("NOT VACUOUS: a candidate that does nothing FAILS the crafted comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft(LIVE_POINT));
  assert.notEqual(d, null, "the comparison passed an empty candidate, so it measures nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: registers and pc, and the scratch pushes", { skip }, () => {
  const a = craft(LIVE_POINT);
  const b = a.clone();
  oracle(a);
  loc_1367(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    EXCLUDED,
    "the excluded set changed shape",
  );
  assert.notEqual(a.pc, b.pc, "the frozen routine's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc`);
});

test("EXHAUSTIVE: every tick value against five attribute priors", { skip }, () => {
  assert.equal(sweepCaught(loc_1367), 0, "the rewrite diverged somewhere in the crafted space");
  assert.ok(POINTS.some(([tick]) => tick === SOUND_AT_TICK), "vacuous: the sweep never asks for " +
    "the sound, so the whole of the routine's first arm is uncovered");
  assert.ok(POINTS.some(([tick]) => tick === 255), "vacuous: the tick counter never wraps");
  console.log(`  EXHAUSTIVE: ${POINTS.length} crafted entries identical, the wrap included`);
});

test("THE MIRRORING BITS SURVIVE: both are kept from a prior that has them set", { skip }, () => {
  const m = craft([1, 0xff]);
  loc_1367(m);
  assert.equal(m.mem8[SPRITE_ATTRIBUTE] & MIRROR_BITS, MIRROR_BITS, "the mirroring bits were lost");
  assert.equal(m.mem8[SPRITE_ATTRIBUTE] & ~MIRROR_BITS, SECOND_COLOUR, "the colour is wrong");
  console.log(`  MIRRORING: 0xff -> ${hex4(m.mem8[SPRITE_ATTRIBUTE])}, top two bits intact`);
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `the ${label} twin's catch count moved`);
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${POINTS.length} crafted entries`);
  });
}

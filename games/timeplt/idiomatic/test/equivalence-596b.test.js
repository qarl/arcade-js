// SPDX-License-Identifier: GPL-3.0-only
/**
 * velocityForHeadingAtFastestSpeed — memory-equivalent to the frozen oracle at ROM 0x596B.
 *
 * WHAT IT IS. Two instructions: fix one velocity table, then fall into the shared lookup, WHICH IS
 * ALREADY DECOMPILED — so the rewrite calls it directly and dissolving that transfer belongs to
 * this caller's unit. The whole content of the entry is therefore WHICH table is chosen, and the
 * gate below is built to see that: the product is a pair of numbers in registers, not memory, so a
 * RAM-only comparison here would pass a candidate that chose any table at all.
 *
 * GATE: poked-natural dispatch with a negative control, replayed over every dispatch of the
 *   session, plus an exhaustive crafted sweep over the heading, plus teeth.
 *
 * WHY A POKE IS NEEDED, AND WHAT IT IS. The three-way choice that reaches this entry takes the
 *   other two arms below era three, and a driven session does not climb that far inside the frame
 *   budget. One cell is held at four from frame 260; the game then dispatches this entry itself.
 *
 * What it exercises, with the holes stated:
 *   1. NEGATIVE CONTROL — the identical driven session without the poke dispatches it ZERO times.
 *   2. EQUAL at the poked dispatch — RAM identical, the stack included, AND the returned pair
 *      identical. The exclusion window is measured at ZERO bytes and asserted so.
 *   3. THE PAIR IS THE PRODUCT — a twin that chooses a different table leaves RAM untouched and is
 *      caught only by the pair, which this file asserts rather than assumes: the RAM-only verdict
 *      on that twin is recorded as BLIND.
 *   4. EXCLUDED, deliberately — the register set that may differ is pinned by measurement, and the
 *      four registers carrying the pair are NOT in it.
 *   5. CORPUS — every dispatch of the poked session replayed on a clone.
 *   6. EXHAUSTIVE — all 256 headings crafted onto a real entry state, with the perpendicular
 *      relation between the two halves of the pair checked on each.
 *   7. TEETH — four twins with exact catch counts over the crafted sweep.
 *
 * HOLE: nothing here says what SPEED the chosen table represents relative to the others, only
 * that it is a different table from its two siblings. Ranking the tables is not this gate's job.
 * HOLE: the poke pins the era, so this covers the era-four arm of the choice and no other.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-596b.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { velocityForHeadingAtFastestSpeed } from "../velocityForHeadingAtFastestSpeed.js";
import { velocityForHeading } from "../velocityForHeading.js";
import { loc_596b as oracle } from "../../translated/loc_596b.js";
import { ERA_INDEX } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x596b;
const FRAMES = 900;
const DISPATCHES = 261;
const ERA_THAT_DISPATCHES = 4;
const POKE_FROM_FRAME = 260;

const HEADING = 2;
const VELOCITY_TABLE = 0x08fa;
const A_SIBLING_TABLE = 0x2e3e;

const SCRATCH_BYTES = 0;
const EXCLUDED = ["a", "f", "h", "l", "sp"];

const HEADINGS = Array.from({ length: 256 }, (_unused, i) => i);

const IN0 = 0xc300;
const IN1 = 0xc320;

const skip = romsPresent() ? false : "ROM images are absent from this checkout";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function playTape() {
  const tape = [
    { frame: 401, port: IN0, bits: 0x01, dur: 8 },
    { frame: 501, port: IN0, bits: 0x08, dur: 8 },
    { frame: 600, port: IN1, bits: 0x10, dur: FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09];
  let frame = 640;
  while (frame < FRAMES) {
    for (const bits of compass) {
      tape.push({ frame, port: IN1, bits, dur: 40 });
      frame += 40;
    }
  }
  return tape;
}

function makePoked(overrides, poked) {
  const m = makeMachine(overrides, { tape: playTape() });
  if (poked) {
    m.pokes = [{ addr: ERA_INDEX, val: ERA_THAT_DISPATCHES, frame: POKE_FROM_FRAME, dur: null }];
  }
  return m;
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

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

/** The RAM-only verdict, which is deliberately separated from the pair. */
function ramDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

/** RAM first, then the pair the lookup hands back. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const sp = machine.regs.sp;
  oracle(a);
  candidate(b);
  const stray = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (stray) return stray;
  if (a.regs.de !== b.regs.de) return { addr: null, a: a.regs.de, b: b.regs.de };
  if (a.regs.bc !== b.regs.bc) return { addr: null, a: a.regs.bc, b: b.regs.bc };
  return null;
}

let entry = null;

function replay(candidate, poked = true) {
  let dispatches = 0;
  let caught = 0;
  const headings = new Set();
  const host = makePoked(new Map([[TARGET, (mm) => {
    dispatches++;
    if (entry === null && poked) entry = mm.clone();
    headings.add(mm.mem8[(mm.regs.ix + HEADING) & 0xffff]);
    const sp = mm.regs.sp;
    const b = mm.clone();
    candidate(b);
    const r = oracle(mm);
    if (allDiffs(mm, b).some((d) => !inScratch(d.addr, sp))) caught++;
    else if (mm.regs.de !== b.regs.de || mm.regs.bc !== b.regs.bc) caught++;
    return r;
  }]]), poked);
  const frames = host.runFrames(FRAMES);
  assert.equal(host.stoppedBy, null, `session stopped early: ${host.stoppedBy}`);
  assert.equal(frames.length, FRAMES, "session ran short");
  return { dispatches, caught, headings };
}

function entryState() {
  if (entry === null) replay(velocityForHeadingAtFastestSpeed);
  assert.notEqual(entry, null, "vacuous: the poked session never reached the routine");
  return entry;
}

/** A real captured machine with the object's heading forced. */
function craft(heading) {
  const m = entryState().clone();
  m.mem8[(m.regs.ix + HEADING) & 0xffff] = heading;
  return m;
}

function sweepCaught(candidate, diff = unitDiff) {
  let caught = 0;
  for (const h of HEADINGS) if (diff(candidate, craft(h))) caught++;
  return caught;
}

// ── twins ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all, so the caller reads whatever the registers held. */
function brokenNoOp() {}

/** BUG: chooses a sibling's table, which is the mistake this entry exists to not make. */
function brokenSiblingTable(m) {
  velocityForHeading(m, A_SIBLING_TABLE);
}

/** BUG: the table starts one sample late, so both halves of the pair are off by one heading. */
function brokenTableOffByOne(m) {
  velocityForHeading(m, VELOCITY_TABLE + 2);
}

/** BUG: hands back the two halves the other way round. */
function brokenSwapsPair(m) {
  velocityForHeading(m, VELOCITY_TABLE);
  const { regs } = m;
  const de = regs.de;
  regs.de = regs.bc;
  regs.bc = de;
}

/**
 * Each twin's exact catch count over the 256 crafted headings, and whether a RAM-ONLY comparison
 * sees it at all. Every one of these is invisible to RAM: the entry writes no memory, which is
 * exactly why the pair is asserted.
 */
const TWINS = [
  ["no-op", brokenNoOp, 256, false],
  ["sibling-table", brokenSiblingTable, 256, false],
  ["table-off-by-one", brokenTableOffByOne, 254, false],
  ["swaps-pair", brokenSwapsPair, 256, false],
];

// ── the control ─────────────────────────────────────────────────────────────────────────

test("NEGATIVE CONTROL: with the era left alone the session never dispatches it", { skip }, () => {
  const r = replay(velocityForHeadingAtFastestSpeed, false);
  assert.equal(r.dispatches, 0, "the unpoked session reached the arm, so the poke proves nothing");
  console.log("  CONTROL: zero dispatches with the era left alone");
});

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the poked dispatch: RAM and the returned pair both agree", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  velocityForHeadingAtFastestSpeed(b);
  assert.deepEqual(allDiffs(a, b), [], "no byte of the dump may differ; this entry writes none");
  assert.equal(a.regs.de, b.regs.de, "the first half of the pair");
  assert.equal(a.regs.bc, b.regs.bc, "the second half");
  console.log(`  EQUAL: pair ${hex4(a.regs.de)}/${hex4(a.regs.bc)}, no byte differs`);
});

test("THE PAIR IS THE PRODUCT: a RAM-only gate is BLIND to every twin here", { skip }, () => {
  for (const [label, twin] of TWINS) {
    assert.equal(sweepCaught(twin, ramDiff), 0,
      `the ${label} twin moved memory, so this entry no longer writes nothing`);
  }
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "a do-nothing candidate must still be caught by the pair");
  assert.equal(d.addr, null, "and it must be caught on the pair, not on a cell");
  console.log(`  PRODUCT: RAM sees none of the four twins; the pair sees them — ${show(d)}`);
});

test("EXCLUDED, deliberately: a pinned register set, and nothing else", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  velocityForHeadingAtFastestSpeed(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    EXCLUDED,
    "the excluded register set changed shape",
  );
  for (const k of ["b", "c", "d", "e"]) {
    assert.ok(!EXCLUDED.includes(k), `${k} carries the pair and may not be excluded`);
  }
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")}`);
});

test("CORPUS: every dispatch of the poked session replays identically", { skip }, () => {
  const r = replay(velocityForHeadingAtFastestSpeed);
  assert.equal(r.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(r.caught, 0, "the rewrite diverged on a real dispatch");
  assert.ok(r.headings.size > 1, "vacuous: the session presents one heading only");
  console.log(`  CORPUS: ${r.dispatches} dispatches, ${r.headings.size} distinct headings`);
});

test("EXHAUSTIVE: all 256 headings, and the two halves stay a quarter turn apart", { skip }, () => {
  assert.equal(sweepCaught(velocityForHeadingAtFastestSpeed), 0, "the rewrite diverged somewhere in the crafted space");
  const pairs = new Set();
  for (const heading of HEADINGS) {
    const m = craft(heading);
    velocityForHeadingAtFastestSpeed(m);
    const quarter = craft((heading - 64) & 0xff);
    velocityForHeadingAtFastestSpeed(quarter);
    assert.equal(m.regs.bc, quarter.regs.de, `heading ${heading}: the halves are not perpendicular`);
    pairs.add(`${m.regs.de}:${m.regs.bc}`);
  }
  assert.ok(pairs.size > 1, "vacuous: every heading produced the same pair");
  console.log(`  EXHAUSTIVE: ${HEADINGS.length} headings identical, ${pairs.size} distinct pairs`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught, ramSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of headings`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's catch count moved`);
    assert.ok(craftedCaught > 0, `the ${label} twin is caught nowhere at all`);
    assert.equal(sweepCaught(twin, ramDiff) > 0, ramSees, `the RAM verdict on ${label} changed`);
    console.log(
      `  TEETH/${label}: caught on ${craftedCaught} of ${HEADINGS.length} headings; ` +
        `RAM alone is ${ramSees ? "enough" : "BLIND, as recorded"}`,
    );
  });
}

// SPDX-License-Identifier: GPL-3.0-only
/**
 * dressSpriteForFineHeading — memory-equivalent to the frozen oracle at ROM 0x2A97.
 *
 * ★ NO TAPE REACHES IT, AND THAT IS ASSERTED, NOT ASSUMED. Three sessions — the shared coin-then-
 *   start tape, an undriven attract run, and a long driven one that fires and steers — dispatch
 *   this address zero times between them. So the entry state is CRAFTED: a machine captured at a
 *   real dispatch of a different per-slot routine, which arrives with both cursors pointing at a
 *   live actor, and then the cells this entry reads are forced. That is a real state with a
 *   surgical nudge, not a fabrication, and the arm below reports the base's two cursors.
 *
 * GATE: EXHAUSTIVE over the routine's entire input space, from that crafted base. It reads exactly
 *   two cells — the heading in the object's record and one bit of a free-running counter — so 256
 *   headings by four counter values covers every distinguishable input. Holes stated:
 *
 *   1. NO TAPE REACHES IT — three sessions, all reported.
 *   2. EXHAUSTIVE — 256 headings against four counter values, poked identically on both sides.
 *   3. IT WRITES EXACTLY TWO CELLS, measured over the whole sweep rather than asserted, outside a
 *      two-byte dead scratch window below the entry stack pointer that every arm pins.
 *   4. THE SWEEP DISCRIMINATES: the shape byte is shown to take several distinct values across the
 *      sweep and to change with the counter bit, so a rewrite that always wrote one shape could
 *      not pass by accident.
 *   5. TEETH — eight twins, each caught on its own exact count over the sweep.
 *
 * HOLE: the base machine's cursors come from a DIFFERENT routine's dispatch, so the object record
 * and the sprite entry are a real pair but not necessarily a pair this address is ever handed.
 * What that costs is realism of the base, not coverage of the arithmetic: the two cells the
 * routine reads are swept exhaustively and the two it writes are checked against the base.
 * HOLE: nothing here says what the two written bytes DO once the display reads them.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2a97.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { dressSpriteForFineHeading } from "../dressSpriteForFineHeading.js";
import { loc_2a97 as oracle } from "../../translated/loc_2a97.js";
import { buildRoutines } from "../../routines.js";
import { offsetAddress } from "../offsetAddress.js";
import { u8, u16 } from "../../../../core/int.js";
import { FRAME_TICK } from "../names.js";

const TARGET = 0x2a97;

/** A per-slot routine the shared tape DOES dispatch, whose cursors are a live actor's. */
const BASE_DISPATCH = 0x2b83;

const HEADING = 2;
const SECTORS = 32;
const STEPS_PER_SECTOR = 256 / SECTORS;
const ENTRY_WIDTH = 2;
const SHAPE_TABLE = 0x2abc;
const ALTERNATE_POSE_BIT = 2;
const ALTERNATE_POSE_SHAPE_STEP = 8;
const SHAPE_IN_ENTRY = 1;
const BESIDE_IT_IN_ENTRY = 48;

/**
 * The dead stack scratch: the frozen entry parks a resume address before the address arithmetic
 * it calls out to, and the stack-free rewrite parks nothing. Measured as an upper bound over the
 * whole sweep, and pinned by every arm.
 */
const SCRATCH_BYTES = 2;

const skip = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr)}: oracle=${d.a} candidate=${d.b}` : "identical");

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** Those divergences falling OUTSIDE the dead scratch window below the entry stack pointer. */
function outsideScratch(a, b, sp) {
  return allDiffs(a, b).filter((d) => d.addr < sp - SCRATCH_BYTES || d.addr >= sp);
}

function compare(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return outsideScratch(a, b, sp)[0] ?? null;
}

const oracles = buildRoutines();

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;

/** Coin, start, then the trigger held while the stick walks round the compass. */
function drivenTape(frames) {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: 632, port: IN1, bits: 0x10, dur: frames },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = 640;
  for (let step = 0; step < 40; step++) {
    tape.push({ frame, port: IN1, bits: compass[step % compass.length], dur: 60 });
    frame += 60;
  }
  return tape;
}

const SESSIONS = [
  ["shared", {}, ENTRY_FRAMES],
  ["attract", { tape: [] }, 3000],
  ["driven", { tape: drivenTape(4000) }, 4000],
];

/** How many times each session dispatches an address. */
function dispatchesOf(address) {
  return SESSIONS.map(([label, opts, frames]) => {
    let hits = 0;
    const m = makeMachine(
      new Map([[address, (mm, ...args) => (hits++, oracles.get(address)(mm, ...args))]]),
      opts,
    );
    m.runFrames(frames);
    assert.equal(m.stoppedBy, null, `the ${label} session stopped early: ${m.stoppedBy}`);
    return [label, hits];
  });
}

let base = null;

/** A machine cloned at the first dispatch of the base routine, whose cursors are an actor's. */
function baseState() {
  if (base !== null) return base;
  const m = makeMachine(
    new Map([[BASE_DISPATCH, (mm, ...args) => {
      if (base === null) base = mm.clone();
      return oracles.get(BASE_DISPATCH)(mm, ...args);
    }]]),
  );
  m.runFrames(ENTRY_FRAMES);
  assert.notEqual(base, null, "the base routine was never dispatched either");
  return base;
}

function craft(heading, counter) {
  const m = baseState().clone();
  m.mem8[u16(m.regs.ix + HEADING)] = heading;
  m.mem8[FRAME_TICK] = counter;
  return m;
}

const COUNTERS = [0, ALTERNATE_POSE_BIT, 0xff, 0x55];
const SWEEP_SIZE = 256 * COUNTERS.length;

function sweepCaught(candidate) {
  let caught = 0;
  for (let heading = 0; heading < 256; heading++) {
    for (const counter of COUNTERS) if (compare(candidate, craft(heading, counter))) caught++;
  }
  return caught;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("NO TAPE REACHES IT: three sessions dispatch it zero times", { skip }, () => {
  const counts = dispatchesOf(TARGET);
  for (const [label, hits] of counts) {
    assert.equal(hits, 0, `the ${label} session now reaches it, so this gate should capture there`);
  }
  const baseCounts = dispatchesOf(BASE_DISPATCH);
  assert.ok(
    baseCounts.some(([, hits]) => hits > 0),
    "the base routine is no longer dispatched either, so the crafted entry has no real machine",
  );
  console.log(
    `  NO TAPE: ${counts.map(([l, h]) => `${l} ${h}`).join(", ")}; base routine ` +
      `${baseCounts.map(([l, h]) => `${l} ${h}`).join(", ")}`,
  );
});

test("THE CRAFTED BASE IS A REAL MACHINE: both cursors are inside work RAM", { skip }, () => {
  const m = baseState();
  assert.ok(m.regs.ix >= 0xa800 && m.regs.ix <= 0xafff, "the record cursor is not in work RAM");
  assert.ok(m.regs.iy >= 0xa800 && m.regs.iy <= 0xafff, "the entry cursor is not in work RAM");
  console.log(`  BASE: record ${hex4(m.regs.ix)}, entry ${hex4(m.regs.iy)}`);
});

test("EXHAUSTIVE: 256 headings against four counter values", { skip }, () => {
  for (let heading = 0; heading < 256; heading++) {
    for (const counter of COUNTERS) {
      const d = compare(dressSpriteForFineHeading, craft(heading, counter));
      assert.equal(d, null, `heading=${heading} counter=${counter}: ${show(d)}`);
    }
  }
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} heading x counter combinations identical`);
});

test("IT WRITES EXACTLY TWO CELLS, over the whole sweep", { skip }, () => {
  const entry = baseState().regs.iy;
  const expected = [entry + SHAPE_IN_ENTRY, entry + BESIDE_IT_IN_ENTRY].sort((x, y) => x - y);
  const seen = new Set();
  for (let heading = 0; heading < 256; heading++) {
    for (const counter of COUNTERS) {
      const before = craft(heading, counter);
      const after = before.clone();
      oracle(after);
      for (const d of outsideScratch(before, after, before.regs.sp)) seen.add(d.addr);
    }
  }
  assert.deepEqual([...seen].sort((x, y) => x - y), expected, "the write set is not the two cells");
  console.log(`  WRITE SET: ${expected.map(hex4).join(" and ")} and nothing else`);
});

test("THE SWEEP DISCRIMINATES: several shapes, and the counter bit moves them", { skip }, () => {
  const entry = baseState().regs.iy;
  const shapes = new Set();
  const beside = new Set();
  for (let heading = 0; heading < 256; heading++) {
    const m = craft(heading, 0);
    oracle(m);
    shapes.add(m.mem8[entry + SHAPE_IN_ENTRY]);
    beside.add(m.mem8[entry + BESIDE_IT_IN_ENTRY]);
  }
  assert.ok(shapes.size > 1, "every heading gave the same shape, so the sweep discriminates nothing");
  assert.ok(beside.size > 1, "every heading gave the same second byte");

  const basePoseRun = craft(0, 0);
  const alternatePoseRun = craft(0, ALTERNATE_POSE_BIT);
  oracle(basePoseRun);
  oracle(alternatePoseRun);
  assert.equal(
    u8(alternatePoseRun.mem8[entry + SHAPE_IN_ENTRY] - basePoseRun.mem8[entry + SHAPE_IN_ENTRY]),
    ALTERNATE_POSE_SHAPE_STEP,
    "the counter bit no longer moves the shape by the amount this file records",
  );
  assert.equal(
    alternatePoseRun.mem8[entry + BESIDE_IT_IN_ENTRY],
    basePoseRun.mem8[entry + BESIDE_IT_IN_ENTRY],
    "the counter bit now moves the second byte too",
  );
  console.log(
    `  DISCRIMINATES: ${shapes.size} shapes and ${beside.size} second bytes over the headings; ` +
      `the counter bit moves the shape by ${ALTERNATE_POSE_SHAPE_STEP}`,
  );
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

function point(m, o) {
  const { mem8, regs } = m;
  const entry = regs.iy;
  const heading = mem8[u16(regs.ix + (o.headingAt ?? HEADING))];
  const sector = Math.floor(
    u8(heading + (o.rounding ?? STEPS_PER_SECTOR / 2)) / (o.stepsPerSector ?? STEPS_PER_SECTOR),
  );
  regs.hl = o.table ?? SHAPE_TABLE;
  regs.a = sector * (o.width ?? ENTRY_WIDTH);
  const selected = offsetAddress(m);
  const alternatePose = (mem8[FRAME_TICK] & (o.bit ?? ALTERNATE_POSE_BIT)) !== 0;
  mem8[entry + SHAPE_IN_ENTRY] = mem8[selected] + (alternatePose ? (o.step ?? ALTERNATE_POSE_SHAPE_STEP) : 0);
  mem8[entry + BESIDE_IT_IN_ENTRY] = mem8[u16(selected + 1)];
}

const TWINS = [
  ["no-op", () => {}, 1024],
  ["no-rounding", (m) => point(m, { rounding: 0 }), 256],
  ["sixteen-sectors", (m) => point(m, { stepsPerSector: 16 }), 864],
  ["single-byte-entries", (m) => point(m, { width: 1 }), 928],
  ["table-off-by-one", (m) => point(m, { table: SHAPE_TABLE + 1 }), 1024],
  ["wrong-counter-bit", (m) => point(m, { bit: 1 }), 512],
  ["wrong-shape-step", (m) => point(m, { step: 4 }), 512],
  ["heading-off-by-one", (m) => point(m, { headingAt: HEADING + 1 }), 960],
];

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of the sweep`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${SWEEP_SIZE} sweep entries`);
  });
}

// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_3e8e — memory-equivalent to the frozen oracle at ROM 0x3E8E.
 *
 * ★ NO TAPE REACHES IT, AND THAT IS ASSERTED, NOT ASSUMED. Three sessions — the shared coin-then-
 *   start tape, an undriven attract run, and a long driven one that fires and steers — dispatch
 *   this address zero times between them. So the entry state is CRAFTED from a machine captured at
 *   a real dispatch of the routine that hands over to it, which arrives with both cursors on a
 *   live slot; the two cells this entry branches on are then forced. A real state, nudged.
 *
 * GATE: an EXHAUSTIVE sweep of the counter byte crossed with the era cell, which together are the
 *   whole of what this entry branches on. Holes stated:
 *
 *   1. NO TAPE REACHES IT, and the routine that hands over to it does — both reported.
 *   2. CROSS — six era values against all 256 counter values, poked identically on both sides,
 *      compared outside a twelve-byte dead scratch window below the entry stack pointer. The
 *      window is where the frozen chain parks resume addresses for calls the stack-free rewrite
 *      makes directly; it is an upper bound, and every arm PINS it so it cannot quietly widen.
 *   3. NOTHING ESCAPES UPWARD, asserted separately: no divergence lands at or above the entry
 *      stack pointer, which is what separates dead scratch from the caller's live stack.
 *   4. EVERY ARM REACHED, asserted rather than assumed: the cross is shown to contain entries that
 *      retire the slot on the era test, entries that retire it on the counter test, entries that
 *      clamp, entries that stop before writing a shape, and entries that write one. The clamp is
 *      also asserted ALWAYS to be followed by a shape, which is a property of where the clamp
 *      value sits relative to the shape threshold rather than of either test alone.
 *   5. NOT VACUOUS — a candidate that does nothing is caught, on a real cell.
 *   6. TEETH — ten twins, each caught on its own exact count over the cross; three of them differ
 *      from the real entry on a handful of counter values only.
 *
 * HOLE: the crafted base has ONE slot under the cursors, so the sweep varies the branch inputs and
 * not which slot they belong to.
 * HOLE: nothing here says what the counter counts or what the eight shapes depict.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3e8e.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_3e8e } from "../loc_3e8e.js";
import { loc_3e8e as oracle } from "../../translated/loc_3e8e.js";
import { driftWithWorldScroll } from "../driftWithWorldScroll.js";
import { ERA_INDEX } from "../names.js";
import { fetchTableByte } from "../fetchTableByte.js";
import { loc_3ecb } from "../loc_3ecb.js";
import { retireSlot } from "../retireSlot.js";
import { buildRoutines } from "../../routines.js";

const TARGET = 0x3e8e;

/** The routine that hands over to this one; the shared tape dispatches it in quantity. */
const BASE_DISPATCH = 0x3e63;

const LAST_ERA = 4;
const COUNTER = 0;
const FLOOR = 1;
const CLAMPED_FROM = 60;
const SHAPES_FROM = 28;
const HELD_FOR = 4;
const SHAPES = 8;
const SHAPE_TABLE = 0x3ec3;
const SHAPE_IN_ENTRY = 1;
const BESIDE_IT_IN_ENTRY = 48;
const BESIDE_IT = 3;

/**
 * The dead stack scratch: the frozen entry parks a resume address before each of the two calls the
 * stack-free rewrite makes directly, and one of those reaches further parks of its own. Measured
 * as an upper bound over the whole cross; a separate arm asserts nothing escapes ABOVE the entry
 * stack pointer, which is the part that would matter.
 */
const SCRATCH_BYTES = 12;

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

function baseState() {
  if (base !== null) return base;
  const m = makeMachine(
    new Map([[BASE_DISPATCH, (mm, ...args) => {
      if (base === null) base = mm.clone();
      return oracles.get(BASE_DISPATCH)(mm, ...args);
    }]]),
  );
  m.runFrames(ENTRY_FRAMES);
  assert.notEqual(base, null, "the routine that hands over to it was never dispatched either");
  return base;
}

function craft(era, counter) {
  const m = baseState().clone();
  m.mem8[ERA_INDEX] = era;
  m.mem8[m.regs.ix + COUNTER] = counter;
  return m;
}

const ERAS = [0, 1, 3, LAST_ERA, 5, 255];
const CROSS_SIZE = ERAS.length * 256;

function eachCrossEntry(body) {
  for (const era of ERAS) {
    for (let counter = 0; counter < 256; counter++) body(era, counter);
  }
}

function crossCaught(candidate) {
  let caught = 0;
  eachCrossEntry((era, counter) => {
    if (compare(candidate, craft(era, counter))) caught++;
  });
  return caught;
}

/** Which arm the frozen entry took, read off the machine it left behind. */
function armOf(era, counter) {
  const before = craft(era, counter);
  const after = before.clone();
  const record = before.regs.ix;
  const entry = before.regs.iy;
  oracle(after);
  if (after.mem8[record + COUNTER] === 0 && after.mem8[entry] === 0) return "retired";
  const clamped = after.mem8[record + COUNTER] !== ((counter - 1) & 0xff);
  const shaped = after.mem8[entry + BESIDE_IT_IN_ENTRY] === BESIDE_IT;
  if (clamped) return shaped ? "clamped and shaped" : "clamped";
  return shaped ? "shaped" : "drifted only";
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
    "the routine that hands over is no longer dispatched, so the crafted entry has no machine",
  );
  console.log(
    `  NO TAPE: ${counts.map(([l, h]) => `${l} ${h}`).join(", ")}; hand-over ` +
      `${baseCounts.map(([l, h]) => `${l} ${h}`).join(", ")}`,
  );
});

test("CROSS: six eras against all 256 counter values", { skip }, () => {
  eachCrossEntry((era, counter) => {
    const d = compare(loc_3e8e, craft(era, counter));
    assert.equal(d, null, `era=${era} counter=${counter}: ${show(d)}`);
  });
  console.log(`  CROSS: ${CROSS_SIZE} era x counter combinations identical`);
});

test("NOTHING ESCAPES UPWARD: no divergence at or above the entry stack pointer", { skip }, () => {
  let deepest = 0;
  let above = 0;
  eachCrossEntry((era, counter) => {
    const machine = craft(era, counter);
    const sp = machine.regs.sp;
    const a = machine.clone();
    const b = machine.clone();
    oracle(a);
    loc_3e8e(b);
    for (const d of allDiffs(a, b)) {
      deepest = Math.max(deepest, sp - d.addr);
      if (d.addr >= sp) above++;
    }
  });
  assert.equal(above, 0, "a divergence reached the caller's live stack");
  assert.ok(
    deepest <= SCRATCH_BYTES,
    `the scratch reaches ${deepest} bytes below the entry stack pointer, past the window named here`,
  );
  console.log(`  SCRATCH: deepest divergence ${deepest} bytes below the entry stack pointer, none above`);
});

test("NOT VACUOUS: a candidate that does nothing is caught on a real cell", { skip }, () => {
  const d = compare(() => {}, craft(LAST_ERA, 100));
  assert.notEqual(d, null, "the masked diff passed a no-op, so memory is NOT the gate here");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EVERY ARM REACHED: the cross contains every outcome this file names", { skip }, () => {
  const arms = new Map();
  eachCrossEntry((era, counter) => {
    const arm = armOf(era, counter);
    arms.set(arm, (arms.get(arm) ?? 0) + 1);
  });
  for (const arm of ["retired", "clamped and shaped", "shaped", "drifted only"]) {
    assert.ok(arms.get(arm) > 0, `no cross entry reached the "${arm}" arm`);
  }
  assert.equal(
    arms.get("clamped") ?? 0,
    0,
    "a clamped entry now stops before writing a shape; the clamp value used to sit above the " +
      "threshold, so this file's account of the two tests interacting is stale",
  );
  assert.equal(armOf(0, 100), "retired", "an era below the last no longer retires the slot");
  assert.equal(armOf(LAST_ERA, FLOOR), "retired", "the counter at its floor no longer retires it");
  console.log(`  ARMS: ${[...arms].map(([k, v]) => `${k} ${v}`).join(", ")}`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

function step(m, o) {
  const { mem8, regs } = m;
  if (mem8[ERA_INDEX] !== (o.era ?? LAST_ERA)) {
    retireSlot(m);
    return;
  }
  const wasAt = mem8[regs.ix + COUNTER];
  if (wasAt === (o.floor ?? FLOOR)) {
    retireSlot(m);
    return;
  }
  mem8[regs.ix + COUNTER] = wasAt - (o.countStep ?? 1);
  if (wasAt >= (o.clampFrom ?? CLAMPED_FROM)) loc_3ecb(m);
  if (!o.dropDrift) driftWithWorldScroll(m);
  const nowAt = mem8[(o.rereads === false ? regs.ix : regs.ix) + COUNTER];
  const source = o.rereads === false ? wasAt - 1 : nowAt;
  if (source < (o.shapesFrom ?? SHAPES_FROM)) return;
  regs.hl = o.table ?? SHAPE_TABLE;
  regs.a = Math.floor((source - (o.shapesFrom ?? SHAPES_FROM)) / (o.heldFor ?? HELD_FOR)) % SHAPES;
  mem8[regs.iy + SHAPE_IN_ENTRY] = fetchTableByte(m);
  mem8[regs.iy + BESIDE_IT_IN_ENTRY] = o.beside ?? BESIDE_IT;
}

const TWINS = [
  ["no-op", () => {}, 1536],
  ["wrong-era", (m) => step(m, { era: 3 }), 510],
  ["wrong-floor", (m) => step(m, { floor: 0 }), 2],
  ["clamp-one-low", (m) => step(m, { clampFrom: CLAMPED_FROM - 1 }), 1],
  ["shapes-one-low", (m) => step(m, { shapesFrom: SHAPES_FROM - 1 }), 203],
  ["held-half-as-long", (m) => step(m, { heldFor: 2 }), 27],
  ["table-off-by-one", (m) => step(m, { table: SHAPE_TABLE + 1 }), 220],
  ["no-drift", (m) => step(m, { dropDrift: true }), 255],
  ["counter-not-reread", (m) => step(m, { rereads: false }), 172],
  ["wrong-byte-beside", (m) => step(m, { beside: BESIDE_IT + 1 }), 228],
];

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of the cross`, { skip }, () => {
    assert.equal(crossCaught(twin), expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${CROSS_SIZE} cross entries`);
  });
}

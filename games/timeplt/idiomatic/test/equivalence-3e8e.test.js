// SPDX-License-Identifier: GPL-3.0-only
/**
 * runSlotCountdownDriftAndAnimateElseRetire — memory-equivalent to the frozen oracle at ROM 0x3E8E.
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
 *      makes directly. It is an upper bound, asserted one-sidedly in the NOTHING ESCAPES UPWARD
 *      arm: a divergence at or above the entry stack pointer fails, and the window's SIZE is a
 *      constant here rather than a measured quantity, so widening it is a source edit and not
 *      something these arms would catch.
 *   2b. REGISTERS — the two slot pointers the caller addresses through, IX and IY, are asserted
 *      HELD, and the remaining divergence is checked against a CEILING rather than an exact set.
 *      This entry is reached only by a tail-jump from 0x3E63 (asserted off the transcribed
 *      sources), so it returns where that one does; DEAD AT EXIT complements every register in the
 *      ceiling but SP at each of 0x3E63's returns over an attract and a coin-start session, on the
 *      oracle, and nothing differs, beside an SP flip at the same exit that is heard.
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
import { runSlotCountdownDriftAndAnimateElseRetire } from "../runSlotCountdownDriftAndAnimateElseRetire.js";
import { loc_3e8e as oracle } from "../../translated/loc_3e8e.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { driftWithWorldScroll } from "../driftWithWorldScroll.js";
import { ERA_INDEX } from "../names.js";
import { fetchTableByte } from "../fetchTableByte.js";
import { clampOneShotCountdownThenRequestTwoSounds } from "../clampOneShotCountdownThenRequestTwoSounds.js";
import { retireSlot } from "../retireSlot.js";
import { buildRoutines } from "../../routines.js";
import { readdirSync, readFileSync } from "node:fs";
import { assertDeadAtExit } from "./_deadAtExit.js";

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

/** Registers that differ between the frozen entry and the rewrite, over the whole cross. */
function movedRegisters() {
  const moved = new Set();
  eachCrossEntry((era, counter) => {
    const m = craft(era, counter);
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    runSlotCountdownDriftAndAnimateElseRetire(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  });
  return moved;
}

/**
 * The register ceiling. Every register in it but SP is shown DEAD where this entry hands back, on the
 * oracle, by DEAD AT EXIT below. L joined it when fetchTableByte stopped leaving HL on the shape
 * entry: the oracle's HL ends on that entry, the rewrite's wherever the drift left it.
 */
const CAP = ["a", "f", "e", "h", "l", "sp"];
/** The only dispatch that tail-jumps here, so its every return is this entry's return. */
const TAIL_FROM = BASE_DISPATCH;
const DEAD_SESSIONS = [["attract", [], 3000], ["coin-start", undefined, 3000]];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("REGISTERS: the slot pointers are held, and nothing outside the cap moves", { skip }, () => {
  const moved = movedRegisters();

  // The two pointers the caller addresses the slot through. Both siblings in this family
  // (0x3DEB, 0x3E6C) hold them, and a rewrite that clobbered either would hand the caller a
  // different slot while every memory cell still matched.
  for (const k of ["ix", "iy"]) {
    assert.ok(!moved.has(k), `${k} moved: the caller's slot pointer must survive the call`);
  }

  // A CEILING, not a set to fill: a rewrite that diverges on FEWER registers must still pass,
  // so this is containment rather than deepEqual. Only a register NOT listed here fails.
  assert.deepEqual([...moved].filter((k) => !CAP.includes(k)), [],
    "a register outside the declared cap diverged");
  console.log(`  REGISTERS: moved ${[...moved].join(",")} — within cap ${CAP.join(",")}`);
});

test("DEAD AT EXIT: every register in the ceiling but SP is dead where the hand-over returns", { skip }, () => {
  // No session dispatches this entry, so its own exit cannot be poisoned. It is entered only by the
  // tail-jump at the end of the hand-over (asserted from the transcribed sources), so it returns
  // wherever the hand-over returns: complement the ceiling at EVERY return of the hand-over, over
  // whole sessions, and require silence. HOLE: the poisoned returns are the hand-over's other
  // arms (this one is never taken), so what is shown is that the return point ignores these
  // registers on every return the sessions make, not on one made from this arm.
  const dir = new URL("../../translated/", import.meta.url);
  const tailers = readdirSync(dir).filter((f) => /^loc_[0-9a-f]+\.js$/.test(f) &&
    readFileSync(new URL(f, dir), "utf8").includes("m.call(0x3e8e)"));
  assert.deepEqual(tailers, [`loc_${TAIL_FROM.toString(16)}.js`], "something else now enters this routine");
  const poison = CAP.filter((k) => k !== "sp");
  // assertDeadAtExit: every session must reach the hand-over's return (reachEvery) and stay silent
  // over its full length; the SP flip at the same return must be heard in some session.
  const exits = assertDeadAtExit({
    at: TAIL_FROM, poison, reachEvery: true,
    sessions: DEAD_SESSIONS.map(([label, tape, frames]) => ({ label, tape, frames })),
  });
  for (const r of exits) {
    assert.equal(r.dead.stopped, null, `${r.label}: the poisoned run stopped early: ${r.dead.stopped}`);
  }
});

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
    const d = compare(runSlotCountdownDriftAndAnimateElseRetire, craft(era, counter));
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
    runSlotCountdownDriftAndAnimateElseRetire(b);
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
  if (wasAt >= (o.clampFrom ?? CLAMPED_FROM)) clampOneShotCountdownThenRequestTwoSounds(m);
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

// SPDX-License-Identifier: GPL-3.0-only
/**
 * flyAndRetireSlotCyclingShapeInEra4 — memory-equivalent to the frozen oracle at ROM 0x3E6C.
 *
 * WHAT IT IS. An object flown one step along the velocity it carries and its slot retired once
 * that step lands it on a retire line, with one era of the game also restyling it first. All four
 * routines it reaches are already decompiled, so every transfer is dissolved into a direct call.
 *
 * ★ HOW THIS FILE HANDLES THE MISSING RETURN. The oracle nets exactly one return on both its
 *   exits — its own conditional one, or the transfer whose target returns for it — and the rewrite
 *   performs neither. That is the shape the dispatch seam exists for, so the candidate is run
 *   THROUGH the seam here, as an assembled run would reach it. The seam MEASURES what the rewrite
 *   did to the stack and throws if it is neither recognised shape, so wiring it in is an assertion,
 *   and it lets SP and pc be compared for EQUALITY on every entry below. Nothing in this file
 *   asserts that the candidate DIFFERS from the oracle anywhere.
 *
 * ★ THE RESTYLING ARM IS CRAFTED-ONLY AND THE CORPUS ARM PROVES IT. No session here ever presents
 *   the era that arm is gated on — the two the tapes reach are asserted as a set — so the arm is
 *   reached by poking that one cell on a real captured machine, identically on both sides.
 *
 * GATE: strict unit-capture over every dispatch of two real sessions, a crafted cross over the era
 *   byte, the two coordinates the line test reads and the counter the shape cycle runs off, and a
 *   whole-machine replay. What it exercises, holes stated:
 *
 *   1. CORPUS SHAPE — dispatch counts per session, and the eras real play presents, as a set.
 *   2. EQUAL at the real dispatch — RAM outside the dead stack window, SP and pc all identical.
 *   3. NOT VACUOUS — a do-nothing twin FAILS the same comparison at the real entry.
 *   4. SEAM — SP and pc agree on every crafted entry and every real dispatch, not just the first.
 *   5. EXCLUDED — the registers that move are reported and bounded by a CEILING, asserted as a
 *      subset rather than an equality so a rewrite agreeing MORE closely cannot fail. SP, pc and
 *      both index registers are asserted to be outside it.
 *   6. EXHAUSTIVE ERA — all 256 values of the one cell that chooses the restyling arm.
 *   7. CRAFTED CROSS — coordinates straddling both retire lines at the restyling era and at a
 *      plain one, and the free-running counter swept far enough to cover the whole shape cycle.
 *   8. ARMS — the cross is shown to reach the retire and the no-retire outcomes, and to write the
 *      shape only in the one era.
 *   9. CORPUS — every dispatch of both sessions replays identically.
 *  10. WHOLE-MACHINE — a driven session with the rewrite wired through the seam, differing only in
 *      dead stack bytes, and the same instrument shown CATCHING a do-nothing twin.
 *  11. TEETH — eight twins, each with an exact crafted catch count.
 *
 * HOLE: one captured machine, and one slot. The era, the two coordinates and the shape counter are
 * varied; which slot the index registers point at is whatever the captured frame left, and the
 * caller that reaches this entry from outside the record walk is not exercised at all.
 * HOLE: the crafted cross reaches a retire by moving the coordinates, not by letting an object fly
 * to the line over many frames.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3e6c.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { flyAndRetireSlotCyclingShapeInEra4 } from "../flyAndRetireSlotCyclingShapeInEra4.js";
import { loc_3e6c as oracle } from "../../translated/loc_3e6c.js";
import { ERA_INDEX, FRAME_TICK } from "../names.js";
import { animateFixedShapeCycle } from "../animateFixedShapeCycle.js";
import { flyAlongStoredVelocity } from "../flyAlongStoredVelocity.js";
import { hasReachedRetireLine } from "../hasReachedRetireLine.js";
import { retireSlot } from "../retireSlot.js";
import { retireSlotIntoSharedCooldown } from "../retireSlotIntoSharedCooldown.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x3e6c;
const CYCLED_SHAPE_ERA = 4;
const SHAPE_SLOT = 1;
const CONTROL_SLOT = 48;
const SECOND_AXIS = 49;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

/** Measured: the widest divergence below the entry stack pointer, over the corpus and the cross. */
const SCRATCH_BYTES = 2;

/**
 * A CEILING on the registers that may differ, not a pin. Membership is asserted as a subset, so a
 * rewrite that happens to agree on one of these still passes; what is asserted positively is that
 * SP, pc and the two index registers are NOT in it.
 */
const MAY_MOVE = ["a", "f", "b", "c", "d", "e", "h", "l"];
const HELD = ["ix", "iy", "sp"];

const CORPUS_FRAMES = 2500;
const SESSIONS = [
  ["coin-start", {}],
  ["demo", { tape: [] }],
];
/** Measured over CORPUS_FRAMES. */
const DISPATCHES = { "coin-start": 131, demo: 859 };
/** Measured: the eras real play presents at this entry. The restyling era is not among them. */
const REAL_ERAS = [0, 1];

/**
 * Measured: the dead stack bytes a whole wired session leaves differing. The lower pair is this
 * entry's own call bracket, which the oracle writes and the rewrite does not. The upper pair is
 * interrupt residue: the rewrite spends no cycles, so the interrupt lands between different
 * instructions and its pushed bytes come to rest at a different depth, popped again before any
 * frame is sampled.
 */
const SESSION_SCRATCH = [0xafe0, 0xafe1, 0xaffd, 0xaffe];
const STACK_FLOOR = 0xaf00;
const STACK_TOP = 0xb000;

/** Coordinates crossed against the era, chosen to straddle both retire lines. */
const COLUMNS = [0, 2, 3, 4, 5, 6, 130, 254, 255];
const ROWS = [0, 100, 246, 247, 248, 249, 250, 255];
const CROSSED_ERAS = [0, CYCLED_SHAPE_ERA];
/** Enough ticks to carry the eight-frame shape cycle through several full turns; the counter
 *  advances every other tick, so a turn takes sixteen. */
const TICKS = 32;

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/** The candidate as an assembled run reaches it: through the seam that supplies the omitted return. */
const seam = (candidate) => withOmittedRet(candidate, TARGET);

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

/** Oracle vs seam-wrapped candidate on two clones: masked RAM, then SP, then pc. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  seam(candidate)(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  if (a.regs.sp !== b.regs.sp) return { addr: null, key: "sp", a: a.regs.sp, b: b.regs.sp };
  if (a.pc !== b.pc) return { addr: null, key: "pc", a: a.pc, b: b.pc };
  return null;
}

let entry = null;
function entryState() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    m.runFrames(CORPUS_FRAMES);
  }
  assert.notEqual(entry, null, "vacuous: the coin-then-start tape never reached the routine");
  return entry;
}

/** A real captured machine with the era, the two coordinates and the shape counter forced. */
function craft(era, column, row, tick) {
  const m = entryState().clone();
  m.mem8[ERA_INDEX] = era;
  if (column !== undefined) m.mem8[m.regs.iy] = column;
  if (row !== undefined) m.mem8[(m.regs.iy + SECOND_AXIS) & 0xffff] = row;
  if (tick !== undefined) m.mem8[FRAME_TICK] = tick;
  return m;
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (let era = 0; era < 256; era++) out.push([era, undefined, undefined, undefined]);
  for (const era of CROSSED_ERAS) {
    for (const column of COLUMNS) for (const row of ROWS) out.push([era, column, row, undefined]);
  }
  for (let tick = 0; tick < TICKS; tick++) out.push([CYCLED_SHAPE_ERA, undefined, undefined, tick]);
  crossCache = out;
  return out;
}

const craftedCaught = (candidate) =>
  cross().filter((c) => unitDiff(candidate, craft(...c)) !== null).length;

function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  const eras = new Set();
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      eras.add(mm.mem8[ERA_INDEX]);
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, eras };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = SESSIONS.map(([label, opts]) => ({ label, ...replaySession(opts, flyAndRetireSlotCyclingShapeInEra4) }));
  }
  return sessionCache;
}

function wholeRunCells(candidate) {
  const base = makeMachine();
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let fired = 0;
  const host = makeMachine(new Map([[TARGET, seam((mm) => (fired++, candidate(mm)))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(CORPUS_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 90);
  }
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < baseFrames[i].length; o++) {
      if (baseFrames[i][o] !== hostFrames[i][o]) cells.add(base.stateOffsetToAddr(o));
    }
  }
  const live = liveStackDiffs(baseFrames, hostFrames, floors, (o) => base.stateOffsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw, stopped: host.stoppedBy };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the restyling never happens, so the object keeps whatever shape it had. */
function brokenNoShapeCycle(m) {
  flyAlongStoredVelocity(m);
  if (hasReachedRetireLine(m)) retireSlot(m);
}

/** BUG: the restyling happens in every era, not only the one it is gated on. */
function brokenShapeInEveryEra(m) {
  animateFixedShapeCycle(m);
  flyAlongStoredVelocity(m);
  if (hasReachedRetireLine(m)) retireSlot(m);
}

/** BUG: the gate is one era out, so the wrong era restyles and the right one does not. */
function brokenWrongEra(m) {
  if (m.mem8[ERA_INDEX] === CYCLED_SHAPE_ERA - 1) animateFixedShapeCycle(m);
  flyAlongStoredVelocity(m);
  if (hasReachedRetireLine(m)) retireSlot(m);
}

/** BUG: nothing is ever retired, so an object that reaches a line keeps its slot. */
function brokenNeverRetires(m) {
  if (m.mem8[ERA_INDEX] === CYCLED_SHAPE_ERA) animateFixedShapeCycle(m);
  flyAlongStoredVelocity(m);
}

/** BUG: every object is retired the tick it moves, whether or not it reached a line. */
function brokenRetiresUnconditionally(m) {
  if (m.mem8[ERA_INDEX] === CYCLED_SHAPE_ERA) animateFixedShapeCycle(m);
  flyAlongStoredVelocity(m);
  retireSlot(m);
}

/** BUG: the sibling retire is used, so the slot goes out with a byte stocked that belongs to another family. */
function brokenRetireIntoCooldown(m) {
  if (m.mem8[ERA_INDEX] === CYCLED_SHAPE_ERA) animateFixedShapeCycle(m);
  flyAlongStoredVelocity(m);
  if (hasReachedRetireLine(m)) retireSlotIntoSharedCooldown(m);
}

/** BUG: the line is tested where the object WAS, so the step that lands on it is missed by a tick. */
function brokenTestsBeforeFlying(m) {
  if (m.mem8[ERA_INDEX] === CYCLED_SHAPE_ERA) animateFixedShapeCycle(m);
  const reached = hasReachedRetireLine(m);
  flyAlongStoredVelocity(m);
  if (reached) retireSlot(m);
}

/** Measured: how many of the crafted entries each twin is caught on. */
const TWINS = [
  ["no-op", brokenNoOp, 432],
  ["no-shape-cycle", brokenNoShapeCycle, 105],
  ["shape-in-every-era", brokenShapeInEveryEra, 327],
  ["wrong-era", brokenWrongEra, 106],
  ["never-retires", brokenNeverRetires, 84],
  ["retires-unconditionally", brokenRetiresUnconditionally, 348],
  ["retire-into-cooldown", brokenRetireIntoCooldown, 84],
  ["tests-before-flying", brokenTestsBeforeFlying, 24],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CORPUS SHAPE: dispatch counts, and the eras real play presents", { skip }, () => {
  const seen = sessions();
  for (const s of seen) {
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} session no longer reaches the routine`);
  }
  const eras = [...new Set(seen.flatMap((s) => [...s.eras]))].sort((x, y) => x - y);
  assert.deepEqual(eras, REAL_ERAS, "the eras real play presents moved, so the crafted cross " +
    "covers the wrong hole");
  assert.ok(!eras.includes(CYCLED_SHAPE_ERA), "real play now reaches the restyling era, so that " +
    "arm is no longer crafted-only and this file's account of it is stale");
  console.log(
    `  CORPUS SHAPE: ${seen.map((s) => `${s.label} ${s.dispatches}`).join("; ")}; eras ${eras.join(",")}`,
  );
});

test("EQUAL at the real dispatch: RAM, SP and pc all identical", { skip }, () => {
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  seam(flyAndRetireSlotCyclingShapeInEra4)(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(a.regs.sp, b.regs.sp, "the stack pointer must come back to the same seat");
  assert.equal(a.pc, b.pc, "the seam must land pc on the address the caller's slot held");
  console.log(
    `  EQUAL: slot ${hex4(e.regs.ix)} entry ${hex4(e.regs.iy)} era ${e.mem8[ERA_INDEX]}; ` +
      `sp ${hex4(a.regs.sp)} pc ${hex4(a.pc)}`,
  );
});

test("NOT VACUOUS: a do-nothing twin FAILS the same comparison at the real entry", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked comparison passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("SEAM: SP and pc agree on every crafted entry and every real dispatch", { skip }, () => {
  for (const c of cross()) {
    const m = craft(...c);
    const sp = m.regs.sp;
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    seam(flyAndRetireSlotCyclingShapeInEra4)(b);
    assert.equal(b.regs.sp, a.regs.sp, `${c}: the seam left SP adrift`);
    assert.equal(b.pc, a.pc, `${c}: the seam left pc adrift`);
    assert.equal(a.regs.sp, (sp + 2) & 0xffff, `${c}: the oracle did not net exactly one return`);
  }
  for (const s of sessions()) assert.equal(s.caught, 0, `${s.label} diverged`);
  console.log(`  SEAM: ${cross().length} crafted entries and every real dispatch place identically`);
});

test("EXCLUDED: the registers that move, bounded by a ceiling; SP, pc and the slots are held", { skip }, () => {
  const moved = new Set();
  for (const c of cross()) {
    const m = craft(...c);
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    seam(flyAndRetireSlotCyclingShapeInEra4)(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
    for (const k of HELD) assert.equal(b.regs[k], a.regs[k], `${c}: ${k} must be held`);
  }
  const list = REG_FIELDS.filter((k) => moved.has(k));
  for (const k of list) assert.ok(MAY_MOVE.includes(k), `${k} moved and is not on the ceiling`);
  console.log(`  EXCLUDED (measured): ${list.join(", ")} — ceiling ${MAY_MOVE.join(", ")}`);
});

test("EXHAUSTIVE and CRAFTED: every entry of the cross is identical", { skip }, () => {
  for (const c of cross()) {
    const d = unitDiff(flyAndRetireSlotCyclingShapeInEra4, craft(...c));
    assert.equal(d, null, `${c}: ${show(d)}`);
  }
  console.log(`  EXHAUSTIVE: 256 eras plus coordinates and shape counter — ${cross().length} entries`);
});

test("ARMS: the cross reaches both retire outcomes, and restyles in one era only", { skip }, () => {
  let retired = 0;
  let kept = 0;
  let restyled = 0;
  let restyledOutsideTheEra = 0;
  for (const c of cross()) {
    const before = craft(...c);
    const after = before.clone();
    oracle(after);
    const shapeMoved =
      after.mem8[(after.regs.iy + SHAPE_SLOT) & 0xffff] !== before.mem8[(before.regs.iy + SHAPE_SLOT) & 0xffff] ||
      after.mem8[(after.regs.iy + CONTROL_SLOT) & 0xffff] !== before.mem8[(before.regs.iy + CONTROL_SLOT) & 0xffff];
    if (after.mem8[after.regs.ix] === 0) retired++;
    else kept++;
    if (shapeMoved) {
      restyled++;
      if (before.mem8[ERA_INDEX] !== CYCLED_SHAPE_ERA) restyledOutsideTheEra++;
    }
  }
  assert.ok(retired > 0, "no crafted entry reaches the retire");
  assert.ok(kept > 0, "no crafted entry keeps its slot, so the line test is not being exercised");
  assert.ok(restyled > 0, "no crafted entry reaches the restyling arm");
  assert.equal(restyledOutsideTheEra, 0, "the oracle restyled outside the era it is gated on");
  console.log(`  ARMS: retired ${retired}, kept ${kept}, restyled ${restyled}, all in one era`);
});

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window`);
});

test("WHOLE-MACHINE: a wired driven session differs only in dead stack bytes", { skip }, () => {
  const r = wholeRunCells(flyAndRetireSlotCyclingShapeInEra4);
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early (${r.stopped})`);
  assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  for (const cell of r.cells) {
    assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${hex4(cell)} is not a stack address`);
  }
  assert.deepEqual(r.cells, SESSION_SCRATCH, "the set of dead stack bytes a whole run leaves " +
    "differing moved, so the exclusion is no longer the measured one");
  console.log(`  WHOLE-MACHINE: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`);
});

test("WHOLE-MACHINE TEETH: the same instrument CATCHES a do-nothing twin", { skip }, () => {
  const r = wholeRunCells(brokenNoOp);
  assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
  const escaped = r.cells.filter((c) => !SESSION_SCRATCH.includes(c));
  assert.ok(
    r.threw !== null || escaped.length > 0,
    "the whole-machine arm passed a candidate that does nothing, so it proves only that the seam " +
      "places the dispatch and nothing about the routine",
  );
  console.log(`  WHOLE-MACHINE TEETH: the no-op leaves ${escaped.length} cells outside the window`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = craftedCaught(twin);
    assert.ok(caught > 0, `the crafted cross missed the ${label} twin everywhere`);
    assert.equal(caught, expected, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
  });
}

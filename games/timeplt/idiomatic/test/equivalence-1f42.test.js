// SPDX-License-Identifier: GPL-3.0-only
/**
 * scrollWorldAtTheEraPace — memory-equivalent to the frozen oracle at ROM 0x1F42.
 *
 * WHAT IT IS. A three-way choice of velocity table keyed on one cell, then the lookup and the
 * world-scroll step that consumes it. Both of those ARE ALREADY DECOMPILED, so the rewrite calls
 * them directly and dissolving the transfers belongs to this caller's unit. The frozen form
 * reaches the scroll step by parking its address as a return for the lookup to land on; the
 * rewrite just calls it, which is the whole of what the exclusion below covers.
 *
 * ★ THE LIVE-OUT IS MEMORY, AND THAT IS DERIVED FROM THE ORACLE'S CALL SITES. Every frozen caller
 *   arrives by a tail jump with nothing pushed, so none of them has an instruction after this to
 *   consume a register; what leaves the routine leaves through the scroll cells and the sprite
 *   entry the scroll step writes. Only registers are in the ceiling, and it is measured, not
 *   assumed — the sweep below reports exactly which move.
 *
 * ★ THE THIRD TABLE IS UNREACHABLE IN BOTH SESSIONS. Attract runs the whole of its 2101
 *   dispatches at one value of the keying cell and the driven tape runs all 1108 at another, so
 *   between them real play exercises two of the three choices and neither of the two boundaries.
 *   Every crafted arm is a real captured machine with that one cell nudged, and the heading sweep
 *   varies the one other input the lookup reads. The twins that live on the boundary are caught
 *   NOWHERE in either session and their zero counts are recorded rather than dropped.
 *
 * GATE: strict unit-capture with one measured exclusion, two replayed sessions, and 1031 crafted
 *   arms — seven values of the keying cell, plus every heading at each of the four values that
 *   bracket the two boundaries.
 *
 * HOLE: ONE object record and ONE captured machine. The heading is swept exhaustively out of that
 * record, but the record itself, and everything else about the machine, is never varied.
 * HOLE: the lookup and the scroll step are gated by their own files. What this file gates is the
 * choice of table, the two boundaries, and the fact that the scroll step runs at all.
 *
 * WHERE THE STACK POINTER IS OWNED. sp sits inside the excluded ceiling here, so a rewrite that
 * leaked stack without writing memory would pass. No gate now owns that: the whole-game gate
 * idiomatic.test.js compares memory only, outside the stack window, under an engine that leaves SP
 * unused. This gate says so rather than implying a coverage it does not have.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-1f42.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { scrollWorldAtTheEraPace } from "../scrollWorldAtTheEraPace.js";
import { negateVelocityIntoWorldScrollThenDressSprite } from "../negateVelocityIntoWorldScrollThenDressSprite.js";
import { velocityForHeading } from "../velocityForHeading.js";
import { loc_1f42 as oracle } from "../../translated/loc_1f42.js";
import { ERA_INDEX, WORLD_SCROLL_X, WORLD_SCROLL_Y } from "../names.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x1f42;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

/** The three tables the keying cell chooses between, and where the boundaries fall. */
const OPENING_ERA_PACE = 0x5e00;
const EARLY_ERA_PACE = 0x2e3e;
const LATER_ERA_PACE = 0x08fa;
const FIRST_LATER_ERA = 3;

/** The heading the lookup reads, as an offset into the object record the caller points at. */
const HEADING_IN_RECORD = 2;
const HEADINGS = 256;

/** Measured by the WINDOW arm: the deepest the oracle's own pushes reach below the entry seat. */
const SCRATCH_BYTES = 2;

/**
 * The ceiling on divergence, and the whole of it: the oracle takes a return the dissolved chain
 * does not, and parks its continuation in a register pair on the way. Not a set the rewrite is
 * required to fill — a rewrite diverging on fewer still passes, so this can never refuse a fix.
 */
const MOVED = ["a", "f", "d", "e", "h", "l", "sp"];

const SESSION_FRAMES = 3000;
/** Dispatches and the keying-cell values each session presents. Measured. */
const DISPATCHES = {
  attract: { total: 2101, eras: { 1: 2101 } },
  driven: { total: 1108, eras: { 0: 1108 } },
};

const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });
const drivenMachine = (overrides) => makeMachine(overrides);
const SESSIONS = [["attract", attractMachine], ["driven", drivenMachine]];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => {
  if (!d) return "identical";
  return d.addr === null || d.addr === undefined
    ? `${d.reg}: oracle=${d.a} candidate=${d.b}`
    : `${hex4(d.addr)}: oracle=${d.a} candidate=${d.b}`;
};

const paceFor = (era) =>
  era === 0 ? OPENING_ERA_PACE : era < FIRST_LATER_ERA ? EARLY_ERA_PACE : LATER_ERA_PACE;

// ── the entry, and the comparison ───────────────────────────────────────────────────────

let entry = null;

function capture(candidate) {
  return unitEquivalence(
    attractMachine,
    TARGET,
    oracle,
    (m) => {
      if (entry === null) entry = m.clone();
      return candidate(m);
    },
    { maxFrames: ENTRY_FRAMES },
  );
}

function entryState() {
  if (entry === null) capture(scrollWorldAtTheEraPace);
  return entry;
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

/** The masked window, and nothing else: the bytes the oracle's own push reaches and no others. */
function inScratch(addr, sp) {
  return addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;
}

/**
 * Oracle vs candidate on clones of `machine`: the whole dump masked to the measured window, then
 * every register outside the ceiling. A candidate that raises counts as caught; only the
 * candidate's side is wrapped, because a raise from the oracle is a harness fault.
 */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, reg: "raised", a: "returned", b: String(e).slice(0, 40) };
  }
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** How far below its seat the oracle's own pushes take the stack pointer, on one entry state. */
function oracleDepth(machine) {
  const c = machine.clone();
  const seat = c.regs.sp;
  let deepest = seat;
  const push = c.push16.bind(c);
  c.push16 = (v) => {
    const r = push(v);
    if (c.regs.sp < deepest) deepest = c.regs.sp;
    return r;
  };
  oracle(c);
  return seat - deepest;
}

// ── the crafted arms ────────────────────────────────────────────────────────────────────
// A real captured machine with the keying cell nudged, which is the crafted-entry idiom. The
// heading sweep then varies the ONE other input the lookup reads, at each of the four values
// that bracket the two boundaries.

const ERA_VALUES = [0, 1, 2, 3, 4, 7, 255];
const SWEPT_ERAS = [0, 1, 2, 3];
const ARM_COUNT = ERA_VALUES.length + SWEPT_ERAS.length * HEADINGS;

function crafted(era, heading) {
  const mm = entryState().clone();
  mm.mem8[ERA_INDEX] = era;
  if (heading !== undefined) mm.mem8[(mm.regs.ix + HEADING_IN_RECORD) & 0xffff] = heading;
  return mm;
}

let armCache = null;
function arms() {
  if (armCache) return armCache;
  armCache = ERA_VALUES.map((era) => [`era-${era}`, crafted(era)]);
  for (const era of SWEPT_ERAS) {
    for (let h = 0; h < HEADINGS; h++) armCache.push([`era-${era}/heading-${h}`, crafted(era, h)]);
  }
  return armCache;
}

/** Every machine this file compares on. What the WINDOW arm measures the oracle over. */
const sweep = () => arms().map(([, mm]) => mm);

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let total = 0;
  let caught = 0;
  const eras = {};
  const m = factory(
    new Map([[TARGET, (mm) => {
      total++;
      const era = mm.mem8[ERA_INDEX];
      eras[era] = (eras[era] ?? 0) + 1;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(SESSION_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, SESSION_FRAMES, "session ran short");
  return { total, caught, eras };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, f]) => ({ label, ...replaySession(f, scrollWorldAtTheEraPace) }));
  return sessionCache;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────
// Each is the module with one choice wrong, calling its callees the way the module calls them. A
// twin going through the registry would match the oracle's stack traffic exactly and so would
// never be masked, which would let the teeth pass without exercising the exclusion.

/** BUG: does nothing — the twin that proves the comparison sees a real dispatch. */
function brokenNoOp() {}

/** BUG: every era gets the opening era's pace. */
function brokenAlwaysOpening(m) {
  velocityForHeading(m, OPENING_ERA_PACE);
  negateVelocityIntoWorldScrollThenDressSprite(m);
}

/** BUG: every era gets the last band's pace. */
function brokenAlwaysLater(m) {
  velocityForHeading(m, LATER_ERA_PACE);
  negateVelocityIntoWorldScrollThenDressSprite(m);
}

/** BUG: the opening era is folded in with the next two instead of having its own pace. */
function brokenNoOpeningCase(m) {
  const era = m.mem8[ERA_INDEX];
  velocityForHeading(m, era < FIRST_LATER_ERA ? EARLY_ERA_PACE : LATER_ERA_PACE);
  negateVelocityIntoWorldScrollThenDressSprite(m);
}

/** BUG: the second band ends one era early. */
function brokenBoundaryAtTwo(m) {
  const era = m.mem8[ERA_INDEX];
  velocityForHeading(m, era === 0 ? OPENING_ERA_PACE
    : era < FIRST_LATER_ERA - 1 ? EARLY_ERA_PACE : LATER_ERA_PACE);
  negateVelocityIntoWorldScrollThenDressSprite(m);
}

/** BUG: the second band runs one era long. */
function brokenBoundaryAtFour(m) {
  const era = m.mem8[ERA_INDEX];
  velocityForHeading(m, era === 0 ? OPENING_ERA_PACE
    : era < FIRST_LATER_ERA + 1 ? EARLY_ERA_PACE : LATER_ERA_PACE);
  negateVelocityIntoWorldScrollThenDressSprite(m);
}

/** BUG: the first and last paces change places, leaving the middle band alone. */
function brokenSwappedEnds(m) {
  const era = m.mem8[ERA_INDEX];
  velocityForHeading(m, era === 0 ? LATER_ERA_PACE
    : era < FIRST_LATER_ERA ? EARLY_ERA_PACE : OPENING_ERA_PACE);
  negateVelocityIntoWorldScrollThenDressSprite(m);
}

/** BUG: looks the pace up and never moves the world with it. */
function brokenNoScroll(m) {
  velocityForHeading(m, paceFor(m.mem8[ERA_INDEX]));
}

/** BUG: uses the pointer the caller happened to be holding instead of choosing a table. */
function brokenForwardsThePointer(m) {
  velocityForHeading(m, m.regs.hl);
  negateVelocityIntoWorldScrollThenDressSprite(m);
}

/** BUG: the two halves of the pair change places on the way to the scroll step. */
function brokenPairSwapped(m) {
  velocityForHeading(m, paceFor(m.mem8[ERA_INDEX]));
  const { regs } = m;
  const first = regs.de;
  regs.de = regs.bc;
  regs.bc = first;
  negateVelocityIntoWorldScrollThenDressSprite(m);
}

const TWINS = [
  ["no-op", brokenNoOp, 1031, { attract: 2101, driven: 1075 }],
  ["always-the-opening-pace", brokenAlwaysOpening, 774, { attract: 2101, driven: 0 }],
  ["always-the-later-pace", brokenAlwaysLater, 771, { attract: 2101, driven: 1108 }],
  ["no-opening-case", brokenNoOpeningCase, 257, { attract: 0, driven: 1108 }],
  ["boundary-at-two", brokenBoundaryAtTwo, 257, { attract: 0, driven: 0 }],
  ["boundary-at-four", brokenBoundaryAtFour, 257, { attract: 0, driven: 0 }],
  ["swapped-ends", brokenSwappedEnds, 517, { attract: 0, driven: 1108 }],
  ["no-scroll", brokenNoScroll, 1031, { attract: 1427, driven: 3 }],
  ["forwards-the-pointer", brokenForwardsThePointer, 1031, { attract: 2101, driven: 1108 }],
  ["pair-swapped", brokenPairSwapped, 1031, { attract: 2101, driven: 1108 }],
];

/**
 * NOT A TOOTH — the EXCLUDED arm's positive control. It chooses the right table and scrolls the
 * right way; what it does is keep that table's address in an index register outside the declared
 * ceiling, which is the one thing the register measurement must be able to report or its clean
 * readings prove nothing.
 */
function keepsThePointer(m) {
  const pace = paceFor(m.mem8[ERA_INDEX]);
  m.regs.iy = pace;
  velocityForHeading(m, pace);
  negateVelocityIntoWorldScrollThenDressSprite(m);
}

/**
 * The BOUNDARY arm's probe: the ORACLE ITSELF plus one byte flipped at `sp + offset`. Built on the
 * oracle so what the arm reports is a property of the MASK alone.
 */
function scribbler(offset) {
  return (m) => {
    const at = (m.regs.sp + offset) & 0xffff;
    oracle(m);
    m.mem8[at] ^= 0xff;
  };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CONTRACT: at the first real dispatch, identical outside the window", { skip }, () => {
  capture(scrollWorldAtTheEraPace);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  scrollWorldAtTheEraPace(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  CONTRACT: entered within ${ENTRY_FRAMES} frames at era ${e.mem8[ERA_INDEX]}, record ` +
      `${hex4(e.regs.ix)}, heading ${e.mem8[(e.regs.ix + HEADING_IN_RECORD) & 0xffff]}, seat ` +
      `${hex4(sp)}; ${all.length} differing bytes, ${strays.length} outside the window`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.ok(all.length <= SCRATCH_BYTES, "more bytes differ than the window is wide");
});

test("WINDOW: the oracle's own deepest push, measured over the whole sweep", { skip }, () => {
  let deepest = 0;
  for (const m of sweep()) deepest = Math.max(deepest, oracleDepth(m));
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat`);
  assert.equal(deepest, SCRATCH_BYTES, "the oracle's stack footprint moved, so the masked window " +
    "is no longer the measured one and every arm below is masking the wrong bytes");
});

test("BOUNDARY: the exclusion is exactly as wide as it declares", { skip }, () => {
  const e = entryState();
  const sp = e.regs.sp;
  const below = unitDiff(scribbler(-SCRATCH_BYTES - 1), e);
  const seat = unitDiff(scribbler(0), e);
  const inside = unitDiff(scribbler(-1), e);
  console.log(
    `  BOUNDARY: ${hex4(sp - SCRATCH_BYTES - 1)} caught, ${hex4(sp)} caught, ${hex4(sp - 1)} masked`,
  );
  assert.notEqual(below, null, "a divergence one byte BELOW the window was swallowed, so the " +
    "exclusion is wider than it declares and a leaking stack pointer would walk out of sight");
  assert.notEqual(seat, null, "a divergence AT the entry seat was swallowed: the window must lie " +
    "strictly below the seat, and live stack above it must still fail");
  assert.equal(inside, null, "a divergence INSIDE the window was caught, so the two catches above " +
    "are the instrument catching everything rather than the boundary being where it says");
});

test("ERA REACH: two of the three tables are reached, and only by crafting the third", { skip },
  () => {
    for (const s of sessions()) {
      console.log(`  ERA REACH (measured) ${s.label}: ${JSON.stringify(s.eras)}`);
      assert.deepEqual(s.eras, DISPATCHES[s.label].eras, `${s.label}: the keying values it presents moved`);
    }
    const seen = new Set(sessions().flatMap((s) => Object.keys(s.eras).map(Number)));
    const paces = new Set([...seen].map(paceFor));
    assert.ok(!paces.has(LATER_ERA_PACE), "a session now reaches the third table, so this file's " +
      "hole about it being crafted-only is out of date and the twins there are no longer only crafted");
    console.log(`  ERA REACH: real play reaches ${paces.size} of 3 tables; the third is crafted only`);
  });

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    assert.equal(s.total, DISPATCHES[s.label].total, `${s.label}: the dispatch count moved`);
    total += s.total;
  }
  assert.ok(total > 0, "vacuous: no session reached the routine at all");
  console.log(`  CORPUS: ${total} real dispatches, identical outside the measured window`);
});

test("THREE PACES: the three tables give three different scrolls, so the choice shows", { skip },
  () => {
    const scrolls = ERA_VALUES.map((era) => {
      const mm = crafted(era);
      oracle(mm);
      return [era, mm.mem16[WORLD_SCROLL_Y], mm.mem16[WORLD_SCROLL_X]];
    });
    const distinct = new Set(scrolls.map(([, y, x]) => `${y},${x}`));
    console.log(
      `  THREE PACES (measured): ${scrolls.map(([e, y, x]) => `era ${e} → ${hex4(y)}/${hex4(x)}`).join(", ")}`,
    );
    assert.equal(distinct.size, 3, "the seven keying values no longer produce exactly three " +
      "distinct scrolls at this heading, so a wrong-table twin could pass unnoticed here");
  });

test("CRAFTED: every arm identical outside the measured window", { skip }, () => {
  const all = arms();
  assert.equal(all.length, ARM_COUNT, "the crafted arm set changed size");
  for (const [label, mm] of all) {
    const d = unitDiff(scrollWorldAtTheEraPace, mm);
    assert.equal(d, null, `${label}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${all.length} arms identical`);
});

/** Which registers a candidate parts company with the oracle on, over the whole sweep. */
function movedOver(candidate) {
  const moved = new Set();
  for (const m of sweep()) {
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    try {
      candidate(b);
    } catch {
      continue;
    }
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  return moved;
}

test("EXCLUDED, deliberately: no register outside the ceiling moves", { skip }, () => {
  const moved = movedOver(scrollWorldAtTheEraPace);
  const control = movedOver(keepsThePointer);
  const controlStrays = REG_FIELDS.filter((k) => control.has(k) && !MOVED.includes(k));
  assert.ok(controlStrays.length > 0, "the measurement reports nothing outside the ceiling even " +
    "for a twin that keeps a table pointer in one, so a clean reading below proves nothing");
  console.log(
    `  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ceiling ` +
      `${MOVED.join(", ")}; the control also moves ${controlStrays.join(", ")}`,
  );
  // MOVED is a CEILING. deepEqual against it would DEMAND the divergence and go RED on a rewrite
  // that became register-exact — a gate that requires a wart refuses the fix.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared ceiling diverged");
});

const CALLEES = [
  ["velocityForHeading", "./velocityForHeading.js"],
  ["negateVelocityIntoWorldScrollThenDressSprite", "./negateVelocityIntoWorldScrollThenDressSprite.js"],
];

function callsRatherThanDispatches(text) {
  return CALLEES.every(([name, file]) => text.includes(`from "${file}"`) && text.includes(`${name}(`))
    && !text.includes("m.call(");
}

test("CALLS, NOT DISPATCHES: the module's text, with the oracle as the control", () => {
  const module = readFileSync(new URL("../scrollWorldAtTheEraPace.js", import.meta.url), "utf8");
  const frozen = readFileSync(new URL("../../translated/loc_1f42.js", import.meta.url), "utf8");
  assert.ok(callsRatherThanDispatches(module),
    "the module does not import and call both callees directly");
  assert.ok(!callsRatherThanDispatches(frozen), "the check passes the frozen oracle, which reaches " +
    "both callees through the registry, so it cannot tell a call from a dispatch");
  console.log("  CALLS, NOT DISPATCHES: both are imported and called; the oracle's own text fails");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, caughtOnArms, perSession] of TWINS) {
  test(`TEETH: the ${label} twin is caught on the declared number of arms`, { skip }, () => {
    const all = arms();
    const caught = all.filter(([, mm]) => unitDiff(twin, mm) !== null).map(([l]) => l);
    const first = all.map(([l, mm]) => [l, unitDiff(twin, mm)]).find(([, d]) => d);
    console.log(`  TEETH/${label}: caught on ${caught.length} of ${all.length} arms; first at ` +
      `${first ? `${first[0]} — ${show(first[1])}` : "nowhere"}`);
    assert.ok(caught.length > 0, `${label}: no arm catches this twin, so it is not a tooth`);
    assert.equal(caught.length, caughtOnArms, `${label}: the number of arms catching it moved`);
  });

  test(`TEETH: the ${label} twin's catch count in each real session`, { skip }, () => {
    const counts = Object.fromEntries(
      SESSIONS.map(([l, f]) => [l, replaySession(f, twin).caught]),
    );
    console.log(`  TEETH/${label}: real sessions catch ${JSON.stringify(counts)}`);
    assert.deepEqual(counts, perSession, `the ${label} twin's real-session catch counts moved`);
  });
}

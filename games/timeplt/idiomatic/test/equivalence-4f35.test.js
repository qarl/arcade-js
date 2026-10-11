// SPDX-License-Identifier: GPL-3.0-only
/**
 * dispatchShotSweepByMotherShipArmed — memory-equivalent to the frozen oracle at ROM 0x4F35.
 *
 * WHAT IT IS. One flag test, two cursor cells staged, and a tail transfer into the shared shot
 * sweep at ROM 0x5211 with the arguments the oracle marshals through registers. Both the sweep
 * and the other arm's entry at ROM 0x4FBF are ALREADY DECOMPILED, so the rewrite calls them
 * directly — with the arguments as real parameters — and dissolving those transfers belongs to
 * this caller's unit.
 *
 * ★ THE ORACLE RETURNS AND THE REWRITE DOES NOT, AND ON SOME ENTRIES IT ALSO PUSHES. This entry
 *   itself pushes nothing; the sweep it transfers into brackets each score it posts with a pushed
 *   return address, so DEAD STACK SCRATCH appears below the seat only on entries where a shot
 *   actually reaches something. The window is MEASURED — the WINDOW arm instruments the oracle's
 *   own `push16` over this file's whole sweep — never assumed and never copied from another gate,
 *   and the captured dispatches alone would have measured it as ZERO, which is exactly the
 *   too-narrow window a crafted hit is here to prevent.
 *
 * WHY THE LIVE-OUT IS MEMORY ONLY, derived from the ORACLE's exit successors and not from the
 *   module: the oracle's tail returns into the frame-service list at 0x11CF, whose very next act
 *   is the next `call` in that list, so no register this entry leaves is read before it is
 *   overwritten. Confirmed by running the tape: the oracle's pc after a captured dispatch is
 *   0x11CF.
 *
 * GATE: strict unit-capture replayed over every dispatch the tape produces, plus a CRAFTED grid,
 *   because the tape reaches this entry only with the flag clear and only with nothing colliding —
 *   both the other arm and every collision are unreachable without one. Each crafted machine is a
 *   real captured one with the shot slots, the target slots and the flag nudged.
 *
 *   1. EQUAL      — identical across the whole state dump outside the measured window, over every
 *                   dispatch the tape produces, and over every crafted machine.
 *   2. WINDOW     — the oracle's own deepest push, measured over the whole sweep and PINNED.
 *   3. BOUNDARY   — the exclusion is exactly as wide as it declares: one byte BELOW the window is
 *                   caught, one AT the entry seat is caught, one INSIDE is masked.
 *   4. ARMS       — both arms are really visited by the sweep, and the crafted grid really
 *                   produces hits as well as misses, so no arm below is scored on an unreached
 *                   path.
 *   5. THE RUN IS SEVEN LONG — measured on the ORACLE: the last two target slots of that run are
 *                   destroyed when a shot reaches them, and an eighth is not. That is the one
 *                   thing distinguishing this entry from its sibling arm, so it is measured rather
 *                   than asserted from the module.
 *   6. THE BOX    — the widest offset that still counts as a hit, measured per axis on the ORACLE
 *                   and identical on both axes.
 *   7. EXCLUDED   — no register outside the declared CEILING moves, with a two-sided control.
 *   8. CALLS, NOT RESTATES — the module's text: it must name each callee's file and call it rather
 *                   than carry that callee's body, with each callee's own body as a control.
 *   9. TEETH      — broken twins with measured catch counts over the sweep.
 *
 * HOLE: both callees are gated by their own files. What this file gates is the flag test, the
 * staging of the two cursor cells, and the arguments handed to the sweep.
 * HOLE: the crafted grid moves ONE target at a time against one planted shot and sweeps one axis
 * against a fixed other axis, so a candidate that crossed the two axes is caught only by the
 * swapped-axes twin's own arm.
 * HOLE: this gate pins the candidate's pc but leaves sp inside the excluded set, so a rewrite that
 * leaked stack without writing memory would pass here.
 * No gate now owns that: the whole-game gate idiomatic.test.js compares memory only, outside the
 * stack window, under an engine that leaves SP unused.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4f35.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { dispatchShotSweepByMotherShipArmed } from "../dispatchShotSweepByMotherShipArmed.js";
import { sweepShotsOverFiveCraftThenMotherShip } from "../sweepShotsOverFiveCraftThenMotherShip.js";
import { destroyTargetsHitByShots } from "../destroyTargetsHitByShots.js";
import { loc_4f35 as oracle } from "../../translated/loc_4f35.js";
import { ERA_INDEX, MOTHER_SHIP_ARMED } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x4f35;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const SHOT_RECORDS = 0xaa80;
const SHOTS = 6;
const RECORD_STRIDE = 16;
const TARGET_RECORDS = 0xa850;
const TARGET_ENTRIES = 0xaa1a;
const TARGETS = 7;
const REACH = 7;
const SPAN = 15;
const ENTRY_STRIDE = 2;
const ENTRY_SECOND_AXIS = 49;
const TARGET_ENTRY_CURSOR = 0xa991;
const TARGET_RECORD_CURSOR = 0xa993;

const STATE = 0;
const SHOT_FIRST_AXIS = 6;
const SHOT_SECOND_AXIS = 4;
const LIVE = 255;
const DESTROYED = 240;
const DORMANT = 0;

/** Measured by the WINDOW arm: the deepest the oracle's own pushes reach below the entry seat. */
const SCRATCH_BYTES = 8;

/**
 * The ceiling on register divergence, and the whole of it: the oracle marshals its arguments
 * through registers and takes a return the dissolved transfer does not. Not a set the rewrite is
 * REQUIRED to fill — a rewrite that diverged on fewer still passes, so this can never refuse a fix.
 */
const CEILING = ["a", "f", "b", "c", "d", "e", "h", "l", "ix", "iy", "sp", "a_"];
/** Outside the ceiling, so the EXCLUDED arm can show the measurement reports one. */
const OUTSIDE = "b_";

/** A planted shot's coordinates: far from the band around zero that an unplaced slot leaves. */
const PLANTED = { first: 0x60, second: 0x50 };
/** Offsets chosen to straddle BOTH edges of the box, so a wrong reach and a wrong span differ. */
const OFFSETS = [-20, -8, -7, -6, -4, 0, 4, 6, 7, 8, 20];
/** One step at a time, for measuring the box rather than sampling it. */
const FINE = Array.from({ length: 41 }, (_unused, i) => i - 20);
const ERAS = [0, 1, 2, 3, 4];
const ARMED = 1;
const WRONG_CURSOR = 0x0000;

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

const HELPERS = [
  ["sweepShotsOverFiveCraftThenMotherShip", "../sweepShotsOverFiveCraftThenMotherShip.js", "WIDE_ERAS"],
  ["destroyTargetsHitByShots", "../destroyTargetsHitByShots.js", "FIRST_AXIS_BAND"],
];

/**
 * The module must import the callee's file and CALL it — with `m` first, whether or not more
 * arguments follow — and must not carry a name out of that callee's own body.
 */
function callsRatherThanRestates(text, [name, file, ownName]) {
  const called = new RegExp(`\\b${name}\\(\\s*m[,)]`);
  return text.includes(`from "./${file.slice(3)}"`) && called.test(text) && !text.includes(ownName);
}

// ── capture and craft ───────────────────────────────────────────────────────────────────

let entries = null;

function captured() {
  if (entries === null) {
    const got = [];
    const host = makeMachine(new Map([[TARGET, (mm) => {
      got.push(mm.clone());
      return oracle(mm);
    }]]));
    host.runFrames(ENTRY_FRAMES);
    assert.equal(host.stoppedBy, null, `the tape stopped early: ${host.stoppedBy}`);
    entries = got;
  }
  assert.ok(entries.length > 0, "vacuous: the tape never reached the routine");
  return entries;
}

const entryState = () => captured()[0];

const targetRecord = (i) =>
  (TARGET_RECORDS & 0xff00) | ((TARGET_RECORDS + i * RECORD_STRIDE) & 0xff);
const targetEntry = (i) => TARGET_ENTRIES + i * ENTRY_STRIDE;
const shotRecord = (i) => (SHOT_RECORDS & 0xff00) | ((SHOT_RECORDS + i * RECORD_STRIDE) & 0xff);

/**
 * A real captured machine with every shot but the chosen ones dormant and planted at one place,
 * every target slot dormant, and then ONE target made live at an offset from the planted shot
 * along one axis. `armed` picks which of the two arms runs; `slots` is how many target slots the
 * crafted state prepares, so an eighth slot can be offered and refused.
 */
function craft({
  target = 0, offset = 0, axis = 0, armed = 0, era = 0, shot = 0, slots = 8, cursors = true,
} = {}) {
  const m = entryState().clone();
  m.mem8[ERA_INDEX] = era;
  m.mem8[MOTHER_SHIP_ARMED] = armed;
  for (let i = 0; i < SHOTS; i++) {
    const rec = shotRecord(i);
    m.mem8[rec + STATE] = i === shot ? LIVE : DORMANT;
    m.mem8[rec + SHOT_FIRST_AXIS] = PLANTED.first;
    m.mem8[rec + SHOT_SECOND_AXIS] = PLANTED.second;
  }
  for (let i = 0; i < slots; i++) {
    m.mem8[targetRecord(i) + STATE] = DORMANT;
    m.mem8[targetEntry(i)] = PLANTED.first;
    m.mem8[targetEntry(i) + ENTRY_SECOND_AXIS] = PLANTED.second;
  }
  if (target !== null) {
    m.mem8[targetRecord(target) + STATE] = LIVE;
    m.mem8[targetEntry(target)] = (PLANTED.first + (axis === 0 ? offset : 0)) & 0xff;
    m.mem8[targetEntry(target) + ENTRY_SECOND_AXIS] =
      (PLANTED.second + (axis === 1 ? offset : 0)) & 0xff;
  }
  if (!cursors) {
    m.mem16[TARGET_RECORD_CURSOR] = WRONG_CURSOR;
    m.mem16[TARGET_ENTRY_CURSOR] = WRONG_CURSOR;
  }
  return m;
}

/** Every crafted machine, with a label. */
function craftedCases() {
  const out = [];
  for (let target = 0; target < TARGETS; target++) {
    for (let axis = 0; axis < 2; axis++) {
      for (const offset of OFFSETS) {
        out.push([`t${target}/a${axis}/${offset}`, craft({ target, axis, offset })]);
      }
    }
  }
  // ★ The flag-set cases have to be chosen to TELL THE TWO ARMS APART, and the obvious one does
  // not: with the sixth target sitting on the shot, both arms destroy it and the twin that ignores
  // the flag goes uncaught. Three shapes do separate them — the SEVENTH target, which only the
  // seven-long run reaches; and the two offsets that fall inside one arm's box and outside the
  // other's, which is why the era is swept here as well.
  for (const era of ERAS) {
    out.push([`armed/era${era}`, craft({ target: 5, armed: ARMED, era })]);
    out.push([`armed/era${era}/edge7`, craft({ target: 5, armed: ARMED, era, offset: 7 })]);
    out.push([`armed/era${era}/edge8`, craft({ target: 5, armed: ARMED, era, offset: 8 })]);
  }
  out.push(["armed/seventh-target", craft({ target: 6, armed: ARMED })]);
  out.push(["armed/no-target", craft({ target: null, armed: ARMED })]);
  out.push(["cursors-wrong", craft({ target: 0, cursors: false })]);
  for (let shot = 0; shot < SHOTS; shot++) {
    out.push([`shot${shot}`, craft({ target: 3, shot })]);
  }
  return out;
}

let crafted = null;
const craftedOnce = () => (crafted ??= craftedCases());

/** Every machine this file compares on. What the WINDOW arm measures the oracle over. */
function sweep() {
  return [
    ...captured().map((m, i) => [`captured-${i}`, m]),
    ...craftedOnce(),
  ];
}

// ── comparison ──────────────────────────────────────────────────────────────────────────

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

function inScratch(addr, sp) {
  return addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;
}

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
    if (CEILING.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

const show = (d) => {
  if (!d) return "identical";
  return d.addr === null
    ? `${d.reg}: oracle=${d.a} candidate=${d.b}`
    : `${hex4(d.addr)}: oracle=${d.a} candidate=${d.b}`;
};

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

/** Whether the ORACLE destroys the chosen target on this crafted state. */
function oracleDestroys(opts) {
  const m = craft(opts);
  oracle(m);
  return m.mem8[targetRecord(opts.target) + STATE] === DESTROYED;
}

function scribbler(offset) {
  return (m) => {
    const at = (m.regs.sp + offset) & 0xffff;
    oracle(m);
    m.mem8[at] ^= 0xff;
  };
}

function regScribbler(k) {
  return (m) => {
    oracle(m);
    m.regs[k] = m.regs[k] ^ 1;
  };
}

// ── broken twins ────────────────────────────────────────────────────────────────────────

function build(o = {}) {
  const opt = {
    honourFlag: true, alwaysArmed: false, stage: true, targets: TARGETS, firstPass: TARGETS,
    shots: SHOTS, reach: REACH, span: SPAN, records: TARGET_RECORDS, ...o,
  };
  return (m) => {
    const { mem8, mem16 } = m;
    const armed = opt.alwaysArmed || (opt.honourFlag && mem8[MOTHER_SHIP_ARMED] !== 0);
    if (armed) {
      sweepShotsOverFiveCraftThenMotherShip(m);
      return;
    }
    if (opt.stage) {
      mem16[TARGET_RECORD_CURSOR] = opt.records;
      mem16[TARGET_ENTRY_CURSOR] = TARGET_ENTRIES;
    }
    destroyTargetsHitByShots(
      m, SHOT_RECORDS, TARGET_ENTRIES, opt.records,
      opt.firstPass, opt.targets, opt.shots, opt.reach, opt.span,
    );
  };
}

/** BUG: does nothing — the twin that proves the comparison sees a real dispatch. */
function brokenNoOp() {}

const TWINS = [
  ["no-op", brokenNoOp],
  ["ignores-the-flag", build({ honourFlag: false })],
  ["always-takes-the-other-arm", build({ alwaysArmed: true })],
  ["five-targets", build({ targets: 5, firstPass: 5 })],
  ["five-on-the-first-pass-only", build({ firstPass: 5 })],
  ["five-shots", build({ shots: 5 })],
  ["no-cursor-staging", build({ stage: false })],
  ["narrow-reach", build({ reach: REACH - 1 })],
  ["narrow-span", build({ span: SPAN - 2 })],
  ["target-run-one-record-on", build({ records: TARGET_RECORDS + RECORD_STRIDE })],
];

function caughtOver(candidate) {
  let caught = 0;
  let first = null;
  for (const [, m] of sweep()) {
    const d = unitDiff(candidate, m);
    if (!d) continue;
    caught++;
    first ??= d;
  }
  return { caught, first };
}

/** Measured catch counts over the sweep. A move in any of them is a finding, and zeros are kept. */
const CATCHES = {
  "no-op": 329,
  // ONLY the flag-set machines chosen to tell the arms apart: the seventh target, and the two
  // box-edge offsets in the eras where the two boxes disagree. The other flag-set machines are
  // blind to it, which is what the note on craftedCases is about.
  "ignores-the-flag": 6,
  "always-takes-the-other-arm": 18,
  // The offsets inside the box on the sixth and seventh target, which are the two the short run
  // never reaches.
  "five-targets": 28,
  "five-on-the-first-pass-only": 28,
  // The one machine where the sixth shot is the live one.
  "five-shots": 1,
  "no-cursor-staging": 312,
  // The two offsets on each axis and target where the boxes disagree.
  "narrow-reach": 28,
  "narrow-span": 28,
  "target-run-one-record-on": 312,
};

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at every real dispatch: identical outside the measured window", { skip }, () => {
  const all = captured();
  let worst = 0;
  for (const e of all) {
    const sp = e.regs.sp;
    const a = e.clone();
    const b = e.clone();
    oracle(a);
    dispatchShotSweepByMotherShipArmed(b);
    const diffs = allDiffs(a, b);
    const strays = diffs.filter((d) => !inScratch(d.addr, sp));
    assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
    assert.ok(diffs.length <= SCRATCH_BYTES, "more bytes differ than the window is wide");
    assert.equal(b.pc, e.pc, "the dissolved transfer never steps, so the rewrite leaves pc where " +
      "it found it; the oracle's pc is its caller's return address instead");
    worst = Math.max(worst, diffs.length);
  }
  console.log(
    `  EQUAL: ${all.length} dispatches within ${ENTRY_FRAMES} frames, seat ` +
      `${hex4(all[0].regs.sp)}; at most ${worst} differing bytes, all inside the window`,
  );
});

test("EQUAL over every crafted machine", { skip }, () => {
  for (const [label, m] of craftedOnce()) {
    const d = unitDiff(dispatchShotSweepByMotherShipArmed, m);
    assert.equal(d, null, `${label}: ${show(d)}`);
  }
  console.log(`  EQUAL (crafted): ${craftedOnce().length} machines identical outside the window`);
});

test("WINDOW: the oracle's own deepest push, measured over the whole sweep", { skip }, () => {
  let deepest = 0;
  let fromCaptured = 0;
  for (const [label, m] of sweep()) {
    const d = oracleDepth(m);
    deepest = Math.max(deepest, d);
    if (label.startsWith("captured")) fromCaptured = Math.max(fromCaptured, d);
  }
  console.log(
    `  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat over the whole ` +
      `sweep, and only ${fromCaptured} over the captured dispatches alone`,
  );
  assert.equal(deepest, SCRATCH_BYTES, "the oracle's stack footprint moved, so the masked window " +
    "is no longer the measured one and every arm below is masking the wrong bytes");
  assert.ok(fromCaptured < deepest, "the captured dispatches alone now reach as deep as the " +
    "crafted ones, so the note above about a too-narrow window is stale");
});

test("BOUNDARY: the exclusion is exactly as wide as it declares", { skip }, () => {
  const base = craft({ target: 0 });
  const sp = base.regs.sp;
  const below = unitDiff(scribbler(-SCRATCH_BYTES - 1), base);
  const seat = unitDiff(scribbler(0), base);
  const inside = unitDiff(scribbler(-1), base);
  console.log(
    `  BOUNDARY: ${hex4(sp - SCRATCH_BYTES - 1)} caught, ${hex4(sp)} caught, ` +
      `${hex4(sp - 1)} masked`,
  );
  assert.notEqual(below, null, "a divergence one byte BELOW the window was swallowed, so the " +
    "exclusion is wider than it declares and a leaking stack pointer would walk out of sight");
  assert.notEqual(seat, null, "a divergence AT the entry seat was swallowed: the window must lie " +
    "strictly below the seat, and live stack above it must still fail");
  assert.equal(inside, null, "a divergence INSIDE the window was caught, so the catches above " +
    "are the instrument catching everything rather than the boundary being where it says");
});

test("ARMS: both arms are visited, and the crafted grid both hits and misses", { skip }, () => {
  let armed = 0;
  let clear = 0;
  for (const [, m] of sweep()) (m.mem8[MOTHER_SHIP_ARMED] !== 0 ? armed++ : clear++);
  assert.ok(armed > 0, "no machine in the sweep has the flag set, so the other arm is unreached");
  assert.ok(clear > 0, "no machine in the sweep has the flag clear");
  let hit = 0;
  let miss = 0;
  for (let target = 0; target < TARGETS; target++) {
    for (const offset of OFFSETS) (oracleDestroys({ target, offset }) ? hit++ : miss++);
  }
  assert.ok(hit > 0, "the crafted grid never destroys anything: every collision arm is vacuous");
  assert.ok(miss > 0, "the crafted grid destroys everything, so a wider box would look the same");
  console.log(
    `  ARMS: ${armed} flag-set and ${clear} flag-clear machines; grid ${hit} hit, ${miss} missed`,
  );
});

test("THE RUN IS SEVEN LONG, measured on the ORACLE", { skip }, () => {
  const reached = [];
  for (let target = 0; target < TARGETS; target++) {
    if (oracleDestroys({ target, offset: 0 })) reached.push(target);
  }
  assert.deepEqual(reached, [0, 1, 2, 3, 4, 5, 6], "the run the oracle sweeps is not the seven " +
    "slots this gate assumes, so the five-target twin below is measuring something else");
  // The negative half: an EIGHTH slot placed on the shot is not touched.
  const eighth = craft({ target: 0, slots: 9 });
  eighth.mem8[targetRecord(TARGETS) + STATE] = LIVE;
  eighth.mem8[targetEntry(TARGETS)] = PLANTED.first;
  eighth.mem8[targetEntry(TARGETS) + ENTRY_SECOND_AXIS] = PLANTED.second;
  oracle(eighth);
  assert.equal(eighth.mem8[targetRecord(TARGETS) + STATE], LIVE, "an eighth slot sitting on the " +
    "shot was destroyed, so the run is longer than seven and the count here is wrong");
  console.log(`  RUN LENGTH: slots ${reached.join(",")} destroyed, the eighth left alone`);
});

test("THE BOX: the widest offset that still counts as a hit, measured per axis", { skip }, () => {
  const widths = [0, 1].map((axis) =>
    FINE.filter((offset) => oracleDestroys({ target: 0, axis, offset })));
  for (const w of widths) {
    assert.ok(w.length > 0, "no offset on one axis produces a hit at all");
    assert.equal(w[w.length - 1] - w[0] + 1, w.length, "the hits on one axis are not contiguous");
  }
  assert.deepEqual(widths[0], widths[1], "the two axes do not share one box, so the single reach " +
    "and span this entry hands the sweep cannot be right for both");
  const w = widths[0];
  console.log(`  BOX: offsets ${w[0]}..${w[w.length - 1]} hit on both axes`);
});

function movedOver(candidate) {
  const moved = new Set();
  for (const [, m] of sweep()) {
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
  const base = craft({ target: 0 });
  const outside = unitDiff(regScribbler(OUTSIDE), base);
  const inside = unitDiff(regScribbler(CEILING[0]), base);
  assert.notEqual(outside, null, `a planted move of ${OUTSIDE} was not reported, so a clean ` +
    "reading below proves nothing");
  assert.equal(inside, null, `a planted move of ${CEILING[0]} WAS reported, so the arm is not ` +
    "excluding the ceiling and the two-sided control has collapsed into one");
  const moved = movedOver(dispatchShotSweepByMotherShipArmed);
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ` +
    `ceiling ${CEILING.join(", ")}; the control moves ${OUTSIDE} and is seen`);
  // CEILING is a CEILING. deepEqual against it would DEMAND the divergence and go RED on a rewrite
  // that became register-exact — a gate that requires a wart refuses the fix.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !CEILING.includes(k)), [],
    "a register outside the declared ceiling diverged");
});

test("CALLS, NOT RESTATES: the module's text, with each callee as a positive control", () => {
  const module = read("../dispatchShotSweepByMotherShipArmed.js");
  for (const helper of HELPERS) {
    assert.ok(callsRatherThanRestates(module, helper), `the module does not call ${helper[0]}`);
    assert.ok(!callsRatherThanRestates(read(helper[1]), helper),
      `the check passes ${helper[0]}'s ` +
      "OWN body, so it cannot tell a call from an inlined copy and proves nothing");
  }
  console.log(`  CALLS, NOT RESTATES: ${HELPERS.map((h) => h[0]).join(", ")} each called, and ` +
    "each of their own bodies fails the same check");
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const { caught, first: d } = caughtOver(twin);
    const total = sweep().length;
    assert.ok(caught > 0, `the masked comparison PASSED the ${label} twin everywhere`);
    assert.equal(caught, CATCHES[label], `the ${label} twin's catch count moved`);
    assert.notEqual(d.addr, null, `the ${label} twin is caught on a register alone, so nothing ` +
      "says a cell it writes is wrong");
    console.log(`  TEETH/${label}: caught on ${caught} of ${total} — first ${show(d)}`);
  });
}

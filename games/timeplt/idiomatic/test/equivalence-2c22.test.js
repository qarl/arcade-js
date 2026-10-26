// SPDX-License-Identifier: GPL-3.0-only
/**
 * moveObjectByStateByteThenRunAppearance — memory-equivalent to the frozen oracle at ROM 0x2C22.
 *
 * WHAT IT IS. One record byte read, one two-way branch on it, and then a shared appearance step
 * that runs whichever way the branch went. All THREE routines it reaches ARE ALREADY DECOMPILED —
 * decrementObjectStateThenFlyAtSlowestSpeed, driftWithWorldScroll and driveObjectAppearanceByPhaseBand — so the rewrite calls them directly and dissolving
 * those transfers belongs to this caller's unit.
 *
 * ★ THE DECLARED RANGE ENDS AT 0x2C30 AND THE CONTINUATION BEGINS AT 0x2C31. The frozen form
 *   pushes that address, jumps to one of two bodies, and borrows their return to arrive at it —
 *   so a rewrite worked from the range rather than from the call graph would inline a routine
 *   that already has a name and a gate of its own. It is not inlined here: CALLS, NOT RESTATES
 *   reads the module's own text for the three imports and for the absence of a marker that
 *   belongs to each callee's body, and runs the same predicate over those callees as a positive
 *   control, so the absence is only evidence once the check is shown able to see it present.
 *
 * ★ THE ORACLE PUSHES AND THE REWRITE DOES NOT, so the bytes just below the entry stack pointer
 *   are dead scratch on one side only. The window is MEASURED, and it is DEEPER on the crafted
 *   low band than at any real dispatch; both figures are pinned separately.
 *
 * ★ THE ORDER IS LOAD-BEARING AND THE GATE SAYS SO. The countdown arm decrements the same record
 *   byte the appearance step then reads, so running the two the other way round paints a
 *   different frame. The order-swapped twin exists for exactly that, and its catch count is
 *   pinned.
 *
 * ★ EVERY REGISTER THAT MOVES HERE IS ALREADY EXCLUDED BY A CALLEE'S OWN GATE. The measured set
 *   is the union of the sets those three files declare, and the EXCLUDED arm asserts that union
 *   rather than an invented list, so this entry cannot quietly widen the exclusion its callees
 *   established.
 *
 * LIVE-OUT, DERIVED FROM THE ORACLE. Its one call site returns immediately after it, so by
 *   reading alone the live-out is MEMORY. Walking further: that caller is reached by a tail from
 *   an era arm, which is reached by a tail from an indexed dispatch, which is reached by a tail
 *   from a record-base setter, and the site THOSE return to is a call that reloads the record
 *   base, the sprite base, the accumulator, the flags and the pair the dispatch reads before any
 *   of them is looked at. I could not close the pair the flag byte lives in by reading — nothing
 *   on that path writes it — so its deadness rests on the whole-machine arm rather than on a
 *   reading, and this file says so rather than claiming the walk finished.
 *
 * GATE: strict unit-capture, two replayed sessions at every dispatch, an exhaustive sweep of the
 *   record byte crossed with the request cell, and a whole-run masked diff.
 *
 *   TEETH: one twin (threshold low by one) is caught by NO real dispatch and no whole run — it only
 *   matters to a record byte the game never presents here, so three crafted entries alone hold it.
 *
 * HOLE: the record bases are the ones attract and the shared tape present; nothing here sweeps
 * the record table, and the sprite base is never varied independently of the record base.
 * HOLE: the low band's retire path writes through a helper this file does not vary; that helper
 * has its own gate and this one only shows both sides take it together.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2c22.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { moveObjectByStateByteThenRunAppearance } from "../moveObjectByStateByteThenRunAppearance.js";
import { decrementObjectStateThenFlyAtSlowestSpeed } from "../decrementObjectStateThenFlyAtSlowestSpeed.js";
import { driveObjectAppearanceByPhaseBand } from "../driveObjectAppearanceByPhaseBand.js";
import { driftWithWorldScroll } from "../driftWithWorldScroll.js";
import { loc_2c22 as oracle } from "../../translated/loc_2c22.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "../names.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x2c22;

const STATE = 0;
const COUNTDOWN_FROM = 32;
const REQUEST = 0xa821;
const RECORD_NUMBER = 15;
// The per-frame world displacement the drift arm reads; poked so the arm has something to move.
// Imported rather than redeclared: names.js names both cells, and a second definition here is a
// second source of truth that a later correction would silently leave behind.

/**
 * Measured. At a real dispatch the oracle parks only the continuation address, two bytes; the
 * crafted low band, where the appearance step posts a command, reaches two bytes further. The
 * window is the deeper figure and the EQUAL arm holds the real dispatch to the shallower one, so
 * widening it cannot pass unnoticed.
 */
const SCRATCH_BYTES = 4;
const SCRATCH_AT_ENTRY = 2;

/**
 * The union of the excluded sets the three callees' own gates declare: {a, f, d, e, h, l, sp}
 * from the countdown arm and {a, f, b, c, sp} from the appearance step.
 */
const MOVED = ["a", "f", "b", "c", "d", "e", "h", "l", "sp"];
const HELD = ["ix", "iy"];

const CORPUS_FRAMES = 2000;
const WHOLE_FRAMES = 1400;
const RET_TSTATES = 10;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");
const everyByte = Array.from({ length: 256 }, (_unused, v) => v);

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * The module's own text against the three routines it is supposed to CALL. Each is identified by
 * a constant or a name out of its own body; the module must name its file, call it, and NOT carry
 * that marker. The same predicate is run over each callee as a positive control, so an absence is
 * only evidence once the check is shown able to see the thing present.
 */
const HELPERS = [
  ["decrementObjectStateThenFlyAtSlowestSpeed", "../decrementObjectStateThenFlyAtSlowestSpeed.js", "flyAtSlowestSpeed"],
  ["driveObjectAppearanceByPhaseBand", "../driveObjectAppearanceByPhaseBand.js", "0x2c94"],
  ["driftWithWorldScroll", "../driftWithWorldScroll.js", "WORLD_SCROLL_X"],
];

function callsRatherThanRestates(text, [name, file, ownMarker]) {
  return text.includes(`from "./${file.slice(3)}"`) &&
    text.includes(`${name}(m`) &&
    !text.includes(ownMarker);
}

const sharedMachine = (overrides) => makeMachine(overrides);
const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });

const SESSIONS = [
  ["shared", sharedMachine],
  ["attract", attractMachine],
];

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { shared: 72, attract: 714 };

// ── the entry, and the masked comparison ────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    sharedMachine,
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
  if (entry === null) gate(moveObjectByStateByteThenRunAppearance);
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

function inScratch(addr, sp) {
  return addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;
}

/** Oracle vs candidate on clones: masked RAM, then the two bases a caller keeps across the call. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  for (const k of HELD) {
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** A real captured machine with the record byte and the outside request forced. */
function craft(state, request) {
  const m = entryState().clone();
  m.mem8[m.regs.ix + STATE] = state;
  m.mem8[REQUEST] = request;
  return m;
}

/** No request, a request naming this record, and one naming a different record. */
function requests() {
  const mine = entryState().mem8[entryState().regs.ix + RECORD_NUMBER] & 0x7f;
  return [0x00, 0x80 | mine, 0x80 | ((mine + 1) & 0x7f)];
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const request of requests()) for (const state of everyByte) out.push([state, request]);
  crossCache = out;
  return out;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  let counted = 0;
  const states = new Set();
  const bases = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      const state = mm.mem8[mm.regs.ix + STATE];
      states.add(state);
      bases.add(mm.regs.ix);
      if (state >= COUNTDOWN_FROM) counted++;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, counted, states, bases };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, moveObjectByStateByteThenRunAppearance) }));
  return sessionCache;
}

// ── the cycle shim ──────────────────────────────────────────────────────────────────────

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

let baselineRun = null;
function baseline() {
  if (!baselineRun) {
    const base = sharedMachine();
    const frames = base.runFrames(WHOLE_FRAMES);
    baselineRun = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o) };
  }
  return baselineRun;
}

function wholeRunCells(candidate) {
  const base = baseline();
  let fired = 0;
  const host = sharedMachine(new Map([[TARGET, (mm) => (fired++, hosted(candidate)(mm))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(WHOLE_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(base.frames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = base.frames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) cells.add(base.offsetToAddr(o));
  }
  const live = liveStackDiffs(base.frames, hostFrames, floors, (o) => base.offsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw };
}

/**
 * Measured: with the correct rewrite wired, no cell differs at any frame boundary over the whole
 * run — the two dead scratch bytes are overwritten before the next sample. A twin verdict is
 * therefore measured against THIS set rather than against the window width.
 */
const STACK_FLOOR = 0xafd0;
const STACK_TOP = 0xb000;
const WHOLE_RUN_CELLS = [];

const sameCells = (cells) =>
  cells.length === WHOLE_RUN_CELLS.length && cells.every((c, i) => c === WHOLE_RUN_CELLS[i]);

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: the threshold is one too low. */
function brokenThresholdLow(m, object = m.regs.ix) {
  if (m.mem8[object + STATE] >= COUNTDOWN_FROM - 1) decrementObjectStateThenFlyAtSlowestSpeed(m, object);
  else driftWithWorldScroll(m);
  driveObjectAppearanceByPhaseBand(m, object);
}

/** BUG: the threshold is one too high. */
function brokenThresholdHigh(m, object = m.regs.ix) {
  if (m.mem8[object + STATE] >= COUNTDOWN_FROM + 1) decrementObjectStateThenFlyAtSlowestSpeed(m, object);
  else driftWithWorldScroll(m);
  driveObjectAppearanceByPhaseBand(m, object);
}

/** BUG: the two arms change places. */
function brokenArmsSwapped(m, object = m.regs.ix) {
  if (m.mem8[object + STATE] >= COUNTDOWN_FROM) driftWithWorldScroll(m);
  else decrementObjectStateThenFlyAtSlowestSpeed(m, object);
  driveObjectAppearanceByPhaseBand(m, object);
}

/** BUG: the appearance step never runs. */
function brokenNoContinuation(m, object = m.regs.ix) {
  if (m.mem8[object + STATE] >= COUNTDOWN_FROM) decrementObjectStateThenFlyAtSlowestSpeed(m, object);
  else driftWithWorldScroll(m);
}

/** BUG: the object never moves; only the appearance step runs. */
function brokenNoMovement(m, object = m.regs.ix) {
  driveObjectAppearanceByPhaseBand(m, object);
}

/** BUG: the appearance step runs first, so it reads a record byte not yet counted down. */
function brokenOrderSwapped(m, object = m.regs.ix) {
  driveObjectAppearanceByPhaseBand(m, object);
  if (m.mem8[object + STATE] >= COUNTDOWN_FROM) decrementObjectStateThenFlyAtSlowestSpeed(m, object);
  else driftWithWorldScroll(m);
}

/** BUG: every object drifts, and the countdown arm is never taken. */
function brokenAlwaysDrifts(m, object = m.regs.ix) {
  driftWithWorldScroll(m);
  driveObjectAppearanceByPhaseBand(m, object);
}

/** BUG: every object counts down, and the drift arm is never taken. */
function brokenAlwaysCounts(m, object = m.regs.ix) {
  decrementObjectStateThenFlyAtSlowestSpeed(m, object);
  driveObjectAppearanceByPhaseBand(m, object);
}

const TWINS = [
  ["no-op", brokenNoOp, 768, [72, 714], true],
  ["threshold-low", brokenThresholdLow, 3, [0, 0], false],
  ["threshold-high", brokenThresholdHigh, 3, [2, 20], true],
  ["arms-swapped", brokenArmsSwapped, 750, [70, 695], true],
  ["no-continuation", brokenNoContinuation, 768, [34, 338], true],
  ["no-movement", brokenNoMovement, 748, [70, 695], true],
  ["order-swapped", brokenOrderSwapped, 29, [8, 79], true],
  ["always-drifts", brokenAlwaysDrifts, 672, [28, 280], true],
  ["always-counts", brokenAlwaysCounts, 78, [42, 415], true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  gate(moveObjectByStateByteThenRunAppearance);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  moveObjectByStateByteThenRunAppearance(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: record ${hex4(e.regs.ix)} holding ${e.mem8[e.regs.ix]}, sprite ${hex4(e.regs.iy)}, ` +
      `sp ${hex4(sp)}; ${all.length} differing bytes, ${strays.length} outside the window`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  for (const k of HELD) assert.equal(a.regs[k], b.regs[k], `a base the caller keeps moved (${k})`);
  assert.ok(all.length <= SCRATCH_AT_ENTRY, "a real dispatch now dirties more of the window than " +
    "the continuation address alone, so the wider figure is no longer only the crafted low band");
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked diff, on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a cell, not on a register alone");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("BOTH ARMS ARE REACHED, and the threshold is located on the frozen side", { skip }, () => {
  const seen = sessions();
  const counted = seen.reduce((n, s) => n + s.counted, 0);
  const drifted = seen.reduce((n, s) => n + s.dispatches - s.counted, 0);
  console.log(`  BOTH ARMS: ${counted} real dispatches take the countdown arm, ${drifted} the drift arm`);
  assert.ok(counted > 0, "no real dispatch takes the countdown arm");
  assert.ok(drifted > 0, "no real dispatch takes the drift arm");
  const boundary = everyByte.filter((state) => {
    const low = craft(state, 0);
    const high = craft(state, 0);
    oracle(low);
    brokenAlwaysDrifts(high);
    return allDiffs(low, high).some((d) => !inScratch(d.addr, entryState().regs.sp));
  });
  assert.equal(Math.min(...boundary), COUNTDOWN_FROM, "the record byte at which the frozen side " +
    "stops drifting is not where this file says it is");
  console.log(`  BOTH ARMS: the frozen side first departs from always-drifting at ${Math.min(...boundary)}`);
});

test("EXCLUDED, deliberately: the union of the callees' own declared sets", { skip }, () => {
  const moved = new Set();
  for (const [state, request] of cross()) {
    const a = craft(state, request);
    const b = a.clone();
    oracle(a);
    moveObjectByStateByteThenRunAppearance(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  // MOVED is the union of the three callees' own declared sets, used as a CEILING: a register
  // outside it fails, but a rewrite that diverges on fewer than all of them still passes. An
  // exact match would demand the divergence and refuse a register-exact rewrite.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register diverged that none of this entry's callees declares excluded");
  for (const k of HELD) assert.ok(!moved.has(k), `a base the caller keeps moved (${k})`);
});

test("UNIFORM CORPUS: what the real corpus presents, measured", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / ${s.states.size} record bytes / ${s.bases.size} ` +
      "bases").join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  const states = new Set(seen.flatMap((s) => [...s.states]));
  assert.ok(states.size < 256, "the corpus now covers every record byte, so the crafted sweep is " +
    "no longer what covers the range");
});

test("CORPUS: every dispatch of two real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window`);
});

test("EXHAUSTIVE: all 256 record bytes crossed with the outside request", { skip }, () => {
  for (const [state, request] of cross()) {
    const d = unitDiff(moveObjectByStateByteThenRunAppearance, craft(state, request));
    assert.equal(d, null, `record byte ${state} request ${request}: ${show(d)}`);
  }
  console.log(`  EXHAUSTIVE: ${cross().length} record byte x request comparisons identical`);
});

test("CALLS, NOT RESTATES: the module's text, with each callee as a positive control", () => {
  const module = read("../moveObjectByStateByteThenRunAppearance.js");
  for (const helper of HELPERS) {
    assert.ok(callsRatherThanRestates(module, helper), `the module does not call ${helper[0]}`);
    assert.ok(!callsRatherThanRestates(read(helper[1]), helper), `the check passes ${helper[0]}'s ` +
      "OWN body, so it cannot tell a call from an inlined copy and proves nothing");
  }
  console.log(`  CALLS, NOT RESTATES: ${HELPERS.map((h) => h[0]).join(", ")} are called, and none ` +
    "of their bodies passes the same check");
});

test("THE BRANCH: which arm a record byte takes, read back off the record", { skip }, () => {
  const stepped = [];
  for (const [state, expected] of [[20, 20], [31, 31], [32, 31], [200, 199], [255, 254]]) {
    const after = craft(state, 0);
    moveObjectByStateByteThenRunAppearance(after);
    assert.equal(after.mem8[after.regs.ix + STATE], expected, `record byte ${state} came back ` +
      `${after.mem8[after.regs.ix + STATE]}, so it took the other arm`);
    stepped.push(`${state}->${after.mem8[after.regs.ix + STATE]}`);
  }
  const drifting = craft(20, 0);
  drifting.mem16[WORLD_SCROLL_X] = 0x0140;
  drifting.mem16[WORLD_SCROLL_Y] = 0x0140;
  const control = drifting.clone();
  const coords = (s) => [s.mem8[s.regs.iy], s.mem8[s.regs.ix + 5], s.mem8[s.regs.iy + 49],
    s.mem8[s.regs.ix + 3]];
  const before = coords(drifting);
  moveObjectByStateByteThenRunAppearance(drifting);
  oracle(control);
  assert.notDeepEqual(coords(drifting), before, "with the world scrolling, the drift arm still " +
    "left both coordinates alone, so this arm cannot see it run");
  assert.deepEqual(coords(drifting), coords(control), "the two sides drift the object differently");
  console.log(`  THE BRANCH: ${stepped.join(" ")}, and a scrolling world moves the drifting object`);
});

test("WHOLE-MACHINE: a driven session leaves no cell differing", { skip }, () => {
  const r = wholeRunCells(moveObjectByStateByteThenRunAppearance);
  console.log(
    `  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, differing cells ` +
      `[${r.cells.map(hex4).join(" ")}]`,
  );
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.frames, WHOLE_FRAMES, `compared ${r.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  for (const cell of r.cells) {
    assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${hex4(cell)} is not a stack address, so a ` +
      "real game cell diverged over the run");
  }
  assert.deepEqual(r.cells, WHOLE_RUN_CELLS, "the set of cells a whole run leaves differing moved");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, crossCaught, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = cross().filter(([s, r]) => unitDiff(twin, craft(s, r)) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
    assert.ok(caught > 0, `the crafted cross missed the ${label} twin everywhere`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = SESSIONS.map(([, factory]) => replaySession(factory, twin));
    console.log(`  TEETH/${label}: real sessions catch ${counts.map((r) => r.caught).join("/")}`);
    for (const [i, r] of counts.entries()) {
      assert.equal(r.caught, perSession[i], `the ${label} twin's ${SESSIONS[i][0]} count moved`);
    }
  });

  test(`TEETH: the whole run sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRunCells(twin);
    const seen = r.threw !== null || !sameCells(r.cells);
    console.log(`  TEETH/${label}: whole run ${seen ? "catches it" : "is BLIND, as recorded"}`);
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.equal(seen, wholeRunSees, `the whole-run verdict on the ${label} twin changed`);
  });
}

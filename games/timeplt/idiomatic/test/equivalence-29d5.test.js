// SPDX-License-Identifier: GPL-3.0-only
/**
 * serviceEra4EnemyCraftSlot — memory-equivalent to the frozen oracle at ROM 0x29d5.
 * GATE: crafted-entry. Neither tape reaches this arm's era within the frame budget, so a run pokes
 * the era index to 4 and lets the rom's own dispatcher reach the address; real dispatches cover the
 * free and live states, and crafted state bytes cover the held, dying and retire branches. Memory
 * outside the dead stack scratch is the contract; the two-byte return drift is asserted, registers
 * excluded as a ceiling since every caller of the dispatch chain is a tail transfer.
 * HOLE: the launch attempt is gated shut on every reachable state, so its writes are unobserved here.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { serviceEra4EnemyCraftSlot } from "../serviceEra4EnemyCraftSlot.js";
import { loc_29d5 as oracle } from "../../translated/loc_29d5.js";
import { loc_290e as dispatcher } from "../../translated/loc_290e.js";
import { hasReachedRetireLine } from "../hasReachedRetireLine.js";
import { releaseHeldObject } from "../releaseHeldObject.js";
import { stepDyingObjectState } from "../stepDyingObjectState.js";
import { steerEra4CraftTowardAimHeadingThenFly } from "../steerEra4CraftTowardAimHeadingThenFly.js";
import { retireSlotAndSubPixel } from "../retireSlotAndSubPixel.js";
import { animateSelectedShapeCycle } from "../animateSelectedShapeCycle.js";
import { fireCraftShotWhenAimedNearPlayer } from "../fireCraftShotWhenAimedNearPlayer.js";
import { launchAttackerIntoFreeSlot } from "../launchAttackerIntoFreeSlot.js";
import { ERA_INDEX } from "../names.js";

const TARGET = 0x29d5;
const DISPATCHER = 0x290e;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const FREE = 0x00;
const HELD = 0xfe;
const LIVE = 0xff;
const ERA_FOUR = 4;
const POKE_FROM = 400;
const CAP = 150;

const RETIRE_COLUMN = 4;
const DATA_TOP = 0xadff;

/** Memory is the whole contract; every register and the return machinery is the excluded ceiling. */
const EXCLUDED = ["a", "b", "c", "d", "e", "h", "l", "f", "sp", "pc", "ix", "iy",
  "a_", "f_", "b_", "c_", "d_", "e_", "h_", "l_"];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr)}: frozen=${d.a} rewrite=${d.b}` : "identical");

// ── captures ──────────────────────────────────────────────────────────────────────────────

let poked = null;

/** Machines the rom itself dispatched here after the era index was forced to four. */
function capturePoked() {
  if (poked) return poked;
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (entries.length < CAP) entries.push(mm.clone());
    return oracle(mm);
  }]]));
  m.pokes = [{ frame: POKE_FROM, addr: ERA_INDEX, val: ERA_FOUR }];
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the poked run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the poked run ran short");
  poked = entries;
  return poked;
}

function aLiveEntry() {
  const e = capturePoked().find((x) => x.mem8[x.regs.ix] === LIVE);
  assert.ok(e, "no live slot was captured, so the crafted arms have nothing to build from");
  return e;
}

/** A live capture with the slot's state byte forced, and optionally moved onto a retire line. */
function craft(state, onLine = false) {
  const e = aLiveEntry().clone();
  e.mem8[e.regs.ix] = state;
  if (onLine) e.mem8[e.regs.iy] = RETIRE_COLUMN;
  return e;
}

/**
 * Oracle vs candidate on independent clones: memory outside the dead stack scratch. The frozen side
 * nets one return, pushing below its seat where the rewrite pushes nothing; [low, seat) is masked,
 * the floor watched off both sides' own pushes.
 */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const pa = a.push16.bind(a);
  a.push16 = (v) => { pa(v); if (a.regs.sp < low) low = a.regs.sp; };
  const pb = b.push16.bind(b);
  b.push16 = (v) => { pb(v); if (b.regs.sp < low) low = b.regs.sp; };
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, a: "returned", b: String(e).slice(0, 40) };
  }
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** The two-byte return drift and the mask floor, watched off the frozen side's own pushes. */
function maskProbe(machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const p = a.push16.bind(a);
  a.push16 = (v) => { p(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  serviceEra4EnemyCraftSlot(b);
  return { low, seat, spDiff: (a.regs.sp - b.regs.sp) & 0xffff };
}

/** How many bytes of the whole dump the oracle moves from this entry. */
function footprint(machine) {
  const before = machine.dumpState().slice();
  const after = machine.clone();
  oracle(after);
  const now = after.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) n++;
  return n;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────────

/** BUG: services nothing, so an active slot is never stepped. */
function brokenNoOp() {}

/** BUG: a held slot is stepped as a dying one instead of being released. */
function brokenHeldAsDying(m) {
  const s = m.mem8[m.regs.ix];
  if (s === FREE) return;
  if (s !== LIVE) return stepDyingObjectState(m);
  steerEra4CraftTowardAimHeadingThenFly(m);
  if (hasReachedRetireLine(m)) return retireSlotAndSubPixel(m);
  animateSelectedShapeCycle(m);
  fireCraftShotWhenAimedNearPlayer(m);
  launchAttackerIntoFreeSlot(m);
}

/** BUG: a dying slot is released as a held one instead of being stepped. */
function brokenDyingAsHeld(m) {
  const s = m.mem8[m.regs.ix];
  if (s === FREE) return;
  if (s !== LIVE) return releaseHeldObject(m);
  steerEra4CraftTowardAimHeadingThenFly(m);
  if (hasReachedRetireLine(m)) return retireSlotAndSubPixel(m);
  animateSelectedShapeCycle(m);
  fireCraftShotWhenAimedNearPlayer(m);
  launchAttackerIntoFreeSlot(m);
}

/** BUG: a live slot always retires, so it never animates or launches. */
function brokenAlwaysRetire(m) {
  const s = m.mem8[m.regs.ix];
  if (s === FREE) return;
  if (s === HELD) return releaseHeldObject(m);
  if (s !== LIVE) return stepDyingObjectState(m);
  steerEra4CraftTowardAimHeadingThenFly(m);
  return retireSlotAndSubPixel(m);
}

/** BUG: a live slot never retires, so one on the line is animated instead of cleared. */
function brokenNeverRetire(m) {
  const s = m.mem8[m.regs.ix];
  if (s === FREE) return;
  if (s === HELD) return releaseHeldObject(m);
  if (s !== LIVE) return stepDyingObjectState(m);
  steerEra4CraftTowardAimHeadingThenFly(m);
  animateSelectedShapeCycle(m);
  fireCraftShotWhenAimedNearPlayer(m);
  launchAttackerIntoFreeSlot(m);
}

/** BUG: the free test is off by one, so the lowest dying state is read as free. */
function brokenState1Free(m) {
  const s = m.mem8[m.regs.ix];
  if (s <= 1) return;
  if (s === HELD) return releaseHeldObject(m);
  if (s !== LIVE) return stepDyingObjectState(m);
  steerEra4CraftTowardAimHeadingThenFly(m);
  if (hasReachedRetireLine(m)) return retireSlotAndSubPixel(m);
  animateSelectedShapeCycle(m);
  fireCraftShotWhenAimedNearPlayer(m);
  launchAttackerIntoFreeSlot(m);
}

/** Each twin with the crafted state that must catch it in memory. */
const TWINS = [
  ["no-op / live", brokenNoOp, () => craft(LIVE)],
  ["no-op / held", brokenNoOp, () => craft(HELD)],
  ["no-op / dying", brokenNoOp, () => craft(0x3c)],
  ["held-as-dying", brokenHeldAsDying, () => craft(HELD)],
  ["dying-as-held", brokenDyingAsHeld, () => craft(0x3c)],
  ["always-retire", brokenAlwaysRetire, () => craft(LIVE)],
  ["never-retire", brokenNeverRetire, () => craft(LIVE, true)],
  ["state-1-free", brokenState1Free, () => craft(0x01)],
];

// ── the gate ──────────────────────────────────────────────────────────────────────────────

test("UNREACHED: neither tape reaches era four, with a positive control", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["undriven", { tape: [] }]]) {
    let seen = 0;
    let control = 0;
    const m = makeMachine(new Map([
      [TARGET, (mm) => { seen++; return oracle(mm); }],
      [DISPATCHER, (mm) => { control++; return dispatcher(mm); }],
    ]), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    // The zero means something only because the same run reached the dispatcher that WOULD route here.
    assert.ok(control > 0, `the ${label} run never reached the era dispatcher, so the tap is blind`);
    assert.equal(seen, 0, `${label} now reaches this era, so plain captures are the better evidence`);
    console.log(`  UNREACHED: ${label} — ${hex4(TARGET)} entered ${seen}, dispatcher ${control}`);
  }
  assert.ok(capturePoked().length > 0, "the same tap counts nothing even with the era forced");
  console.log(`  CONTROL: with the era forced the same tap counts ${capturePoked().length}+ dispatches`);
});

test("POKED DISPATCH: real dispatches after the era is forced", { skip }, () => {
  const entries = capturePoked();
  assert.ok(entries.length > 0, "vacuous: forcing the era no longer reaches this address");
  for (const e of entries) {
    const d = unitDiff(serviceEra4EnemyCraftSlot, e);
    assert.equal(d, null, `a poked dispatch diverged: ${show(d)}`);
  }
  const states = new Set(entries.map((e) => e.mem8[e.regs.ix]));
  assert.ok(states.has(FREE) && states.has(LIVE), "the captures miss the free or the live arm");
  const footprints = entries.map(footprint);
  assert.ok(footprints.some((n) => n > 0), "every dispatch writes nothing, so a no-op would pass");
  console.log(`  POKED DISPATCH: ${entries.length} identical; states ${[...states].map(hex4)}`);
});

test("STATE ARMS: free, held, dying and live all reproduce", { skip }, () => {
  for (const s of [FREE, 0x01, 0x3c, 0x80, 0xf0, HELD, LIVE]) {
    assert.equal(unitDiff(serviceEra4EnemyCraftSlot, craft(s)), null, `state ${hex4(s)} diverged`);
  }
  assert.equal(footprint(craft(FREE)), 0, "the free arm should move nothing");
  assert.ok(footprint(craft(LIVE)) > 0, "the live arm should move memory");
  console.log(`  STATE ARMS: identical; free moves 0, live moves ${footprint(craft(LIVE))}`);
});

test("RETIRE BRANCH: a live slot on the line clears rather than animates", { skip }, () => {
  const onLine = craft(LIVE, true);
  assert.ok(hasReachedRetireLine(onLine.clone()), "the crafted slot is not actually on a retire line");
  assert.ok(!hasReachedRetireLine(craft(LIVE).clone()), "the plain live slot is already on the line");
  assert.equal(unitDiff(serviceEra4EnemyCraftSlot, onLine), null, "the retire branch diverged");
  console.log("  RETIRE BRANCH: on-line slot reproduces the clear");
});

test("SP AND SCRATCH: the return drift is two bytes and the mask floor sits above the data",
  { skip }, () => {
    for (const s of [FREE, HELD, LIVE, 0x3c]) {
      const r = maskProbe(craft(s));
      assert.equal(r.spDiff, 2, `state ${hex4(s)} no longer nets one return (${r.spDiff})`);
      assert.ok(r.low > DATA_TOP, `state ${hex4(s)} stack window ${hex4(r.low)} reached into data`);
    }
    const r = maskProbe(craft(LIVE));
    console.log(`  SP AND SCRATCH: drift 2; window floor ${hex4(r.low)} over a live slot`);
  });

for (const [label, twin, make] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const d = unitDiff(twin, make());
    assert.notEqual(d, null, `the ${label} twin escaped in memory`);
    console.log(`  TEETH/${label}: caught at ${show(d)}`);
  });
}

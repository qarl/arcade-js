// SPDX-License-Identifier: GPL-3.0-only
/**
 * serviceEra2EnemyCraftSlot — memory-equivalent to the frozen oracle at ROM 0x2984.
 * GATE: crafted-entry. No plain tape reaches this handler, so the corpus is a driven session with
 * the era index pinned; equality is masked over the frozen side's own stack pushes, which the
 * ret-free rewrite never writes. Held (0xFE) never occurs live, so the four state branches are
 * pinned on crafted entries. HOLE: one pinned era; a crafted branch forces one real slot's state.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2984.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, romsPresent } from "./_harness.js";
import { serviceEra2EnemyCraftSlot } from "../serviceEra2EnemyCraftSlot.js";
import { loc_2984 as oracle } from "../../translated/loc_2984.js";
import { ERA_INDEX, FRAME_TICK } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { steerTowardAimHeading } from "../steerTowardAimHeading.js";
import { flyAtSlowestSpeed } from "../flyAtSlowestSpeed.js";
import { hasReachedRetireLine } from "../hasReachedRetireLine.js";
import { retireSlotAndSubPixel } from "../retireSlotAndSubPixel.js";
import { fireCraftShotWhenAimedNearPlayer } from "../fireCraftShotWhenAimedNearPlayer.js";
import { dressSpriteForFineHeading } from "../dressSpriteForFineHeading.js";
import { launchAttackerIntoFreeSlot } from "../launchAttackerIntoFreeSlot.js";
import { releaseHeldObject } from "../releaseHeldObject.js";
import { stepDyingObjectState } from "../stepDyingObjectState.js";

const TARGET = 0x2984;
const EMPTY = 0x00;
const ACTIVE = 0xff;
const HELD = 0xfe;
const DYING = 0x20;

const PINNED_ERA = 2;
const PIN_FROM_FRAME = 700;
const CORPUS_FRAMES = 2000;
const CAP = 500;
const DISPATCHES = 5019;
const SP_DRIFT = 2;
/** Every real data write lands at or below here; the stack seats far above it. */
const DATA_TOP = 0xaeff;
/** The registers the dropped register dance may leave differing; ix and iy are NOT among them. */
const EXCLUDED = ["a", "f", "sp", "b", "c", "d", "e", "l", "a_", "h"];

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} rewrite=${d.b}` : "identical");

/** Coin, start, trigger held, and the stick walked round the compass for the whole session. */
function playTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: START_FRAME + 100, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09];
  let frame = START_FRAME + 140;
  let i = 0;
  while (frame < CORPUS_FRAMES) {
    tape.push({ frame, port: IN1, bits: compass[i++ % compass.length], dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}
const TAPE = playTape();

function pinnedMachine(overrides) {
  const m = makeMachine(overrides, { tape: TAPE });
  m.pokes = [{ addr: ERA_INDEX, val: PINNED_ERA, frame: PIN_FROM_FRAME, dur: null }];
  return m;
}

/** Oracle vs candidate on clones of one machine, masked over the oracle's own stack pushes: the
 *  frozen side brackets each call and rets once more, and the rewrite writes none of that. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  candidate(b);
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr !== null && addr >= low && addr < seat) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

function maskProbe(machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  serviceEra2EnemyCraftSlot(b);
  return { low, seat, spDiff: a.regs.sp - b.regs.sp };
}

/** Bytes the oracle moves from this entry (outside the stack window). */
function footprint(machine) {
  const before = machine.dumpState().slice();
  const seat = machine.regs.sp;
  const after = machine.clone();
  let low = seat;
  const push = after.push16.bind(after);
  after.push16 = (v) => { push(v); if (after.regs.sp < low) low = after.regs.sp; };
  oracle(after);
  const now = after.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) {
    if (now[i] === before[i]) continue;
    const addr = after.stateOffsetToAddr(i);
    if (addr !== null && addr >= low && addr < seat) continue;
    n++;
  }
  return n;
}

// ── the pinned corpus ─────────────────────────────────────────────────────────────────────

let corpus = null;
function captureCorpus() {
  if (corpus) return corpus;
  const clones = [];
  const states = new Map();
  let dispatches = 0;
  let active = null;
  const m = pinnedMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    const state = mm.mem8[mm.regs.ix & 0xffff];
    states.set(state, (states.get(state) || 0) + 1);
    if (clones.length < CAP) clones.push(mm.clone());
    if (!active && state === ACTIVE) active = mm.clone();
    return oracle(mm);
  }]]));
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `the pinned session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "the pinned session ran short");
  assert.notEqual(active, null, "vacuous: the pinned session produced no active slot");
  corpus = { clones, states, dispatches, active };
  return corpus;
}

const craft = (state) => {
  const m = captureCorpus().active.clone();
  m.mem8[m.regs.ix & 0xffff] = state;
  return m;
};

/** Replay the whole pinned session, comparing candidate to oracle at every single dispatch. */
function replayAll(candidate) {
  let dispatches = 0;
  let caught = 0;
  let first = null;
  const m = pinnedMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    const d = unitDiff(candidate, mm);
    if (d) { caught++; if (!first) first = d; }
    return oracle(mm);
  }]]));
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `the replay stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "the replay ran short");
  return { dispatches, caught, first };
}

function movedOver(candidate) {
  const moved = new Set();
  const machines = [...captureCorpus().clones, craft(EMPTY), craft(ACTIVE), craft(HELD), craft(DYING)];
  for (const e of machines) {
    const a = e.clone();
    const b = e.clone();
    oracle(a);
    try { candidate(b); } catch { continue; }
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  return moved;
}

// ── broken twins ──────────────────────────────────────────────────────────────────────────

function twinNoOp() {}
function twinSkipFly(m) {
  const { regs, mem8 } = m;
  const s = mem8[regs.ix];
  if (s === EMPTY) return;
  if (s === ACTIVE) {
    if ((mem8[FRAME_TICK] & 3) < 3) steerTowardAimHeading(m);
    if (hasReachedRetireLine(m)) return retireSlotAndSubPixel(m);
    fireCraftShotWhenAimedNearPlayer(m); dressSpriteForFineHeading(m); launchAttackerIntoFreeSlot(m);
    return;
  }
  if (s === HELD) return releaseHeldObject(m);
  return stepDyingObjectState(m);
}
function twinRetireAlways(m) {
  const { regs, mem8 } = m;
  const s = mem8[regs.ix];
  if (s === EMPTY) return;
  if (s === ACTIVE) {
    if ((mem8[FRAME_TICK] & 3) < 3) steerTowardAimHeading(m);
    flyAtSlowestSpeed(m); hasReachedRetireLine(m);
    return retireSlotAndSubPixel(m);
  }
  if (s === HELD) return releaseHeldObject(m);
  return stepDyingObjectState(m);
}
function twinHeldAsDying(m) {
  const { regs, mem8 } = m;
  const s = mem8[regs.ix];
  if (s === EMPTY) return;
  if (s === ACTIVE) return loc_2984Active(m);
  return stepDyingObjectState(m);
}
function twinIdleRunsDying(m) {
  const { regs, mem8 } = m;
  const s = mem8[regs.ix];
  if (s === ACTIVE) return loc_2984Active(m);
  if (s === HELD) return releaseHeldObject(m);
  return stepDyingObjectState(m);
}
/** The correct active arm, reused by two twins that only bend a dispatch edge. */
function loc_2984Active(m) {
  const { mem8 } = m;
  if ((mem8[FRAME_TICK] & 3) < 3) steerTowardAimHeading(m);
  flyAtSlowestSpeed(m);
  if (hasReachedRetireLine(m)) return retireSlotAndSubPixel(m);
  fireCraftShotWhenAimedNearPlayer(m); dressSpriteForFineHeading(m); launchAttackerIntoFreeSlot(m);
}
function twinMovesIx(m) { serviceEra2EnemyCraftSlot(m); m.regs.ix = (m.regs.ix + 1) & 0xffff; }

/** [name, twin, {idle, active, held, dying}] — which crafted branch each twin parts company on. */
const TWINS = [
  ["no-op", twinNoOp, { idle: 0, active: 1, held: 1, dying: 1 }],
  ["skip-fly", twinSkipFly, { idle: 0, active: 1, held: 0, dying: 0 }],
  ["retire-always", twinRetireAlways, { idle: 0, active: 1, held: 0, dying: 0 }],
  ["held-as-dying", twinHeldAsDying, { idle: 0, active: 0, held: 1, dying: 0 }],
  ["idle-runs-dying", twinIdleRunsDying, { idle: 1, active: 0, held: 0, dying: 0 }],
];

// ── the gate ──────────────────────────────────────────────────────────────────────────────

test("UNREACHED: no plain tape dispatches this handler, which is why the era is pinned", { skip }, () => {
  for (const [label, opts] of [["shared", {}], ["attract", { tape: [] }], ["turning", { tape: TAPE }]]) {
    let hits = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => (hits++, oracle(mm))]]), opts);
    m.runFrames(CORPUS_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    assert.equal(hits, 0, `the ${label} tape now reaches this handler, so the pin is no longer the variable`);
  }
  console.log("  UNREACHED: shared, attract and the same tape unpinned all reach it 0 times");
});

test("CORPUS: every dispatch of the pinned session replays identically", { skip }, () => {
  const c = captureCorpus();
  const r = replayAll(serviceEra2EnemyCraftSlot);
  assert.equal(r.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(r.caught, 0, `a real dispatch diverged: ${show(r.first)}`);
  assert.ok(c.states.get(EMPTY) > 0, "no empty slot occurred");
  assert.ok(c.states.get(ACTIVE) > 0, "no active slot occurred");
  console.log(`  CORPUS: ${r.dispatches} dispatches all identical; ` +
    `empty ${c.states.get(EMPTY)}, active ${c.states.get(ACTIVE)}`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked comparison on an active slot", { skip }, () => {
  const d = unitDiff(twinNoOp, craft(ACTIVE));
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("SP AND SCRATCH: the drift is two bytes and the mask floor sits above the data", { skip }, () => {
  for (const state of [ACTIVE, DYING]) {
    const r = maskProbe(craft(state));
    assert.equal(r.spDiff, SP_DRIFT, `the frozen side no longer re-seats two bytes higher (${r.spDiff})`);
    assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached down into game data`);
  }
  const r = maskProbe(craft(ACTIVE));
  console.log(`  SP AND SCRATCH: spDiff ${r.spDiff}; window floor ${hex4(r.low)} above ${hex4(DATA_TOP)}`);
});

test("EXCLUDED, deliberately: nothing outside the ceiling moves, ix and iy held", { skip }, () => {
  const moved = movedOver(serviceEra2EnemyCraftSlot);
  const unexpected = REG_FIELDS.filter((k) => moved.has(k) && !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  assert.ok(!moved.has("ix") && !moved.has("iy"), "the slot pointers moved, breaking the threading");
  const control = movedOver(twinMovesIx);
  assert.ok(control.has("ix"), "the control twin's scribble on ix went unseen, so this arm is blind");
  console.log(`  EXCLUDED: moved ${[...moved].sort().join(", ")}; ix/iy held; control moves ix`);
});

test("CRAFTED BRANCHES: all four state branches replay identically and each acts", { skip }, () => {
  for (const [label, state, acts] of [["empty", EMPTY, false], ["active", ACTIVE, true],
    ["held", HELD, true], ["dying", DYING, true]]) {
    const m = craft(state);
    assert.equal(unitDiff(serviceEra2EnemyCraftSlot, m), null, `the ${label} branch diverged`);
    assert.equal(footprint(m) > 0, acts, `the ${label} branch's footprint contradicts its arm`);
  }
  console.log("  CRAFTED BRANCHES: empty (idle), active, held, dying all identical");
});

for (const [label, twin, matrix] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const caught = {};
    for (const [name, state] of [["idle", EMPTY], ["active", ACTIVE], ["held", HELD], ["dying", DYING]]) {
      caught[name] = unitDiff(twin, craft(state)) ? 1 : 0;
    }
    let corpusCaught = 0;
    for (const e of captureCorpus().clones) if (unitDiff(twin, e)) corpusCaught++;
    assert.deepEqual(caught, matrix, `the ${label} twin's crafted catch matrix moved`);
    assert.ok(corpusCaught + Object.values(matrix).reduce((a, b) => a + b, 0) > 0,
      `every sweep PASSED the ${label} twin`);
    console.log(`  TEETH/${label}: crafted ${JSON.stringify(caught)}, corpus ${corpusCaught}/${CAP}`);
  });
}

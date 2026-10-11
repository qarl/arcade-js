// SPDX-License-Identifier: GPL-3.0-only
/**
 * serviceEra3EnemyCraftSlot — memory-equivalent to the frozen oracle at ROM 0x29b0.
 * GATE: crafted-entry. No tape reaches this era, so the corpus is poked real dispatches (ERA_INDEX
 * forced to 3) plus per-branch crafts off a plain era-0 neighbour; masked RAM diff, live-out memory.
 * HOLE: the poked run forces an era the cabinet would not enter on its own.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { serviceEra3EnemyCraftSlot } from "../serviceEra3EnemyCraftSlot.js";
import { loc_29b0 as oracle } from "../../translated/loc_29b0.js";
import { steerTowardAimHeading } from "../steerTowardAimHeading.js";
import { flyAtFastestSpeed } from "../flyAtFastestSpeed.js";
import { hasReachedRetireLine } from "../hasReachedRetireLine.js";
import { retireSlotAndSubPixel } from "../retireSlotAndSubPixel.js";
import { fireCraftShotWhenAimedNearPlayer } from "../fireCraftShotWhenAimedNearPlayer.js";
import { dressSpriteForCoarseHeading } from "../dressSpriteForCoarseHeading.js";
import { launchAttackerIntoFreeSlot } from "../launchAttackerIntoFreeSlot.js";
import { releaseHeldObject } from "../releaseHeldObject.js";
import { stepDyingObjectState } from "../stepDyingObjectState.js";

const TARGET = 0x29b0;
const DISPATCH = 0x290e;
const ERA_INDEX = 0xad04;
const ERA_3 = 3;
const POKE_FROM = 500;
const RETIRE_COLUMN = 4;
const DATA_TOP = 0xadff;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr)}: frozen=${d.a} rewrite=${d.b}` : "identical");

/** Oracle vs candidate on independent clones; the frozen side pushes below its seat and takes a
 * return the rewrite leaves, so [low, seat) is masked, low watched off the oracle's own pushes. */
function maskedDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: 0, a: "returned", b: String(e).slice(0, 40) };
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

function spProbe(machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  serviceEra3EnemyCraftSlot(b);
  return { seat, low, spDiff: (a.regs.sp - b.regs.sp) & 0xffff };
}

function footprint(machine) {
  const before = machine.dumpState().slice();
  const after = machine.clone();
  oracle(after);
  const now = after.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) n++;
  return n;
}

let poked = null;
let neighbour = null;

function capturePoked() {
  if (poked) return poked;
  const seen = [];
  let collecting = true;
  const m = makeMachine(new Map([[TARGET, (mm) => { if (collecting) seen.push(mm.clone()); return oracle(mm); }]]));
  m.pokes = [{ frame: POKE_FROM, addr: ERA_INDEX, val: ERA_3 }];
  const frames = m.runFrames(ENTRY_FRAMES);
  collecting = false;
  assert.equal(m.stoppedBy, null, `the poked run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the poked run ran short");
  poked = seen;
  return poked;
}

function captureNeighbour() {
  if (neighbour) return neighbour;
  const m = makeMachine();
  const real = m.routines.get(DISPATCH);
  let first = null;
  m.routines.set(DISPATCH, (mm) => { if (!first) first = mm.clone(); return real(mm); });
  m.runFrames(ENTRY_FRAMES);
  assert.ok(first, "vacuous: the era dispatcher was never reached, so there is no state to craft from");
  neighbour = first;
  return neighbour;
}

/** A plain era-0 object-slot machine with its lifecycle byte forced to one branch value. */
function craft(state, retire = false) {
  const m = captureNeighbour().clone();
  m.mem8[m.regs.ix] = state;
  if (retire) m.mem8[m.regs.iy] = RETIRE_COLUMN;
  return m;
}

const BRANCHES = [
  ["idle", 0x00, false, 0],
  ["dying-low", 0x01, false, 1],
  ["dying-death", 0x3c, false, 1],
  ["dying-rearm", 0xf0, false, 1],
  ["held", 0xfe, false, 1],
  ["live", 0xff, false, 1],
  ["live-retire", 0xff, true, 1],
];
const craftedCorpus = () => BRANCHES.map(([, s, r]) => craft(s, r));

function twinNoOp() {}
function twinBodyEmpty(m) {
  const s = m.mem8[m.regs.ix];
  if (s === 0) return;
  if (s !== 0xff) { if (s === 0xfe) return releaseHeldObject(m); return stepDyingObjectState(m); }
}
function twinSwapDyingRelease(m) {
  const s = m.mem8[m.regs.ix];
  if (s === 0) return;
  if (s !== 0xff) { if (s === 0xfe) return stepDyingObjectState(m); return releaseHeldObject(m); }
  steerTowardAimHeading(m); flyAtFastestSpeed(m);
  if (hasReachedRetireLine(m)) return retireSlotAndSubPixel(m);
  fireCraftShotWhenAimedNearPlayer(m); dressSpriteForCoarseHeading(m); return launchAttackerIntoFreeSlot(m);
}
function twinSkipRetire(m) {
  const s = m.mem8[m.regs.ix];
  if (s === 0) return;
  if (s !== 0xff) { if (s === 0xfe) return releaseHeldObject(m); return stepDyingObjectState(m); }
  steerTowardAimHeading(m); flyAtFastestSpeed(m);
  hasReachedRetireLine(m);
  fireCraftShotWhenAimedNearPlayer(m); dressSpriteForCoarseHeading(m); return launchAttackerIntoFreeSlot(m);
}
function twinHeldAsDying(m) {
  const s = m.mem8[m.regs.ix];
  if (s === 0) return;
  if (s !== 0xff) return stepDyingObjectState(m);
  steerTowardAimHeading(m); flyAtFastestSpeed(m);
  if (hasReachedRetireLine(m)) return retireSlotAndSubPixel(m);
  fireCraftShotWhenAimedNearPlayer(m); dressSpriteForCoarseHeading(m); return launchAttackerIntoFreeSlot(m);
}
const TWINS = [
  ["no-op", twinNoOp],
  ["body-empty", twinBodyEmpty],
  ["swap-dying-release", twinSwapDyingRelease],
  ["skip-retire", twinSkipRetire],
  ["held-as-dying", twinHeldAsDying],
];

test("UNREACHED: neither tape dispatches this era, the dispatcher being the live control", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["undriven", { tape: [] }]]) {
    const seen = { [TARGET]: 0, [DISPATCH]: 0 };
    const m = makeMachine(new Map([[TARGET, (mm) => { seen[TARGET]++; return oracle(mm); }]]), opts);
    const real = m.routines.get(DISPATCH);
    m.routines.set(DISPATCH, (mm) => { seen[DISPATCH]++; return real(mm); });
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    // The zero counts only because the same run counted the dispatcher; a tap that could never fire
    // looks identical to an era nothing reaches.
    assert.ok(seen[DISPATCH] > 0, `${label} never reached the dispatcher, so the instrument is blind`);
    assert.equal(seen[TARGET], 0, `${label} now reaches this era, so the crafted corpus is stale`);
    console.log(`  UNREACHED: ${label} — ${hex4(TARGET)} ${seen[TARGET]}, dispatcher ${hex4(DISPATCH)} ${seen[DISPATCH]}`);
  }
});

test("POKED DISPATCH: era forced to 3, the ROM reaches the address itself", { skip }, () => {
  const entries = capturePoked();
  assert.ok(entries.length > 0, "vacuous: forcing the era no longer makes the ROM reach this address");
  for (const e of entries) {
    const d = maskedDiff(serviceEra3EnemyCraftSlot, e);
    assert.equal(d, null, `a poked dispatch diverged: ${show(d)}`);
  }
  assert.ok(entries.slice(0, 200).some((e) => footprint(e) > 0),
    "every poked dispatch writes nothing, so these comparisons would pass a rewrite that did nothing");
  console.log(`  POKED DISPATCH: ${entries.length} real dispatches identical`);
});

test("CRAFTED BRANCHES: every arm of the lifecycle dispatch, identical and covered", { skip }, () => {
  for (const [label, state, retire, wantsWrite] of BRANCHES) {
    const m = craft(state, retire);
    assert.equal(maskedDiff(serviceEra3EnemyCraftSlot, m), null, `the ${label} arm diverged`);
    const f = footprint(m);
    if (wantsWrite) assert.ok(f > 0, `the ${label} arm wrote nothing, so it exercises no work`);
    else assert.equal(f, 0, `the ${label} arm wrote ${f} bytes but idle must be inert`);
  }
  // live-retire must actually take the retire fork, not fall through to the spawn tail.
  const r = craft(0xff, true);
  oracle(r);
  assert.equal(r.mem8[r.regs.ix], 0, "forcing the retire line did not take the retire fork");
  console.log(`  CRAFTED BRANCHES: ${BRANCHES.length} arms identical and covered`);
});

test("SP AND SCRATCH: the drift is two bytes and the mask floor sits above the data", { skip }, () => {
  for (const m of [...craftedCorpus(), ...capturePoked().slice(0, 50)]) {
    const r = spProbe(m);
    assert.equal(r.spDiff, 2, `the frozen side no longer re-seats two bytes higher (${r.spDiff})`);
    assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached down into game data`);
  }
  const r = spProbe(craft(0xff));
  console.log(`  SP AND SCRATCH: spDiff 2; window floor ${hex4(r.low)} over a live slot`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const corpus = craftedCorpus();
    const caught = corpus.filter((m) => maskedDiff(twin, m)).length;
    const onPoked = capturePoked().slice(0, 200).filter((m) => maskedDiff(twin, m)).length;
    assert.ok(caught > 0, `every crafted arm PASSED the ${label} twin`);
    console.log(`  TEETH/${label}: caught ${caught}/${corpus.length} crafted, ${onPoked}/200 poked`);
  });
}

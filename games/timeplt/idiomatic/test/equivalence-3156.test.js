// SPDX-License-Identifier: GPL-3.0-only
/**
 * seatFinalEraSceneryFillThenClearEraScenery — poked-natural dispatch, then a MASKED diff on independent clones. Choose the fill
 * byte, then transfer into the routine that owns the cells it fills. The dissolved callee drops its
 * tail return, so the frozen side re-seats two bytes higher and leaves a return address in the dead
 * stack scratch the rewrite never writes; that window is masked, its floor proved above every data
 * cell. Registers are not compared: control leaves and does not come back. The dispatch fires only
 * at era four, which neither tape reaches, so the era is poked and the scenery setup dispatches it.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3156.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { seatFinalEraSceneryFillThenClearEraScenery } from "../seatFinalEraSceneryFillThenClearEraScenery.js";
import { loc_3156 as oracle } from "../../translated/loc_3156.js";
import { ERA_INDEX } from "../names.js";

const TARGET = 0x3156;
const ERA_THAT_DISPATCHES = 4;
const POKE_FROM_FRAME = 260;

/** The fill byte this entry chooses, and the run of cells the destination writes it into. */
const FILL_BYTE = 40;
const FILLED_RUN_START = 0xaa60;
const FILLED_RUN_STRIDE = 2;
const FILLED_RUN_CELLS = 8;

/** The byte the fall-through path would otherwise have handed on. */
const THE_OTHER_FILL_BYTE = 0xcc;

/** Every data write lands at or below here; the stack seats far above it. */
const DATA_TOP = 0xadff;

const SKIP = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── capture ───────────────────────────────────────────────────────────────────────────────────

const entries = new Map();

function capture(poked) {
  if (entries.has(poked)) return entries.get(poked);
  let entry = null;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracle(mm);
  }]]), { tape: [] });
  if (poked) {
    m.pokes = [{ addr: ERA_INDEX, val: ERA_THAT_DISPATCHES, frame: POKE_FROM_FRAME, dur: null }];
  }
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the ${poked ? "poked" : "unpoked"} run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the run ran short");
  entries.set(poked, entry);
  return entry;
}

const entryState = () => capture(true);

/**
 * Oracle vs candidate on independent clones. The frozen side takes a return the rewrite leaves to
 * the seam and pushes into the stack scratch on its way; the diff excludes [low, seat), low watched
 * off the oracle's own pushes. Anything outside that window has escaped.
 */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  cand(b);
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  return { escaped, low, seat, spDiff: a.regs.sp - b.regs.sp };
}

function filledRun(machine) {
  const out = [];
  for (let i = 0; i < FILLED_RUN_CELLS; i++) {
    out.push(machine.mem8[FILLED_RUN_START + i * FILLED_RUN_STRIDE]);
  }
  return out;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("NEGATIVE CONTROL: with the era left alone the game never dispatches", { skip: SKIP }, () => {
  assert.equal(capture(false), null, "an unpoked attract run reached this arm — the poke proves nothing");
  assert.notEqual(entryState(), null, "vacuous: the poked run never reached the routine either");
  console.log("  CONTROL: zero dispatches with the era left alone, one with it poked");
});

test("EQUAL at the poked dispatch: masked RAM identical, the drift asserted", { skip: SKIP }, () => {
  const r = compare(seatFinalEraSceneryFillThenClearEraScenery, entryState());
  assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${hex4(r.escaped.addr)}`);
  assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached down into game data`);
  assert.equal(r.spDiff, 2, "the frozen side pops a return the rewrite leaves, so sp+2 is owed");
  console.log(`  EQUAL: window [${hex4(r.low)},${hex4(r.seat)}) masked, spDiff ${r.spDiff}`);
});

test("THE BYTE LANDS: the filled run holds the chosen byte, so the RAM arm is not vacuous", { skip: SKIP }, () => {
  const m = entryState().clone();
  seatFinalEraSceneryFillThenClearEraScenery(m);
  assert.deepEqual(filledRun(m), new Array(FILLED_RUN_CELLS).fill(FILL_BYTE), "every filled cell must hold it");
  assert.notEqual(FILL_BYTE, THE_OTHER_FILL_BYTE, "the two fill bytes must actually differ");
  console.log(`  LANDS: ${FILLED_RUN_CELLS} cells from ${hex4(FILLED_RUN_START)} all read ${FILL_BYTE}`);
});

// ── teeth ─────────────────────────────────────────────────────────────────────────────────────

const DESTINATION = 0x30d1;

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: chooses the byte and forgets to hand control on. */
function brokenNoTransfer(m) {
  m.regs.a = FILL_BYTE;
}

/** BUG: hands control on without choosing the byte, so the caller's stale value is used. */
function brokenNoChoice(m) {
  return m.call(DESTINATION);
}

/** BUG: the byte the fall-through path would have used. */
function brokenOtherByte(m) {
  m.regs.a = THE_OTHER_FILL_BYTE;
  return m.call(DESTINATION);
}

const neighbour = (delta) => (m) => {
  m.regs.a = FILL_BYTE + delta;
  return m.call(DESTINATION);
};

for (const [label, twin] of [
  ["no-op", brokenNoOp],
  ["chooses-but-does-not-transfer", brokenNoTransfer],
  ["transfers-without-choosing", brokenNoChoice],
  ["uses-the-fall-through-byte", brokenOtherByte],
  ["one-below", neighbour(-1)],
  ["one-above", neighbour(+1)],
]) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip: SKIP }, () => {
    const r = compare(twin, entryState());
    assert.notEqual(r.escaped, null, `the gate PASSED the ${label} twin — it has no teeth outside the mask`);
    console.log(`  TEETH/${label}: caught at ${hex4(r.escaped.addr)}`);
  });
}

// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchEnemyActorAnimTickState (ROM 0x7638, Pooyan) — the per-entry animation-tick
 * dispatcher, a DISSOLVED caller-skip propagator. It selects a tick-state handler by the low two
 * bits of the entry's state byte (0/1/2) and tail-hands to it, returning the handler's control-flow
 * boolean straight through.
 *
 * The oracle drives the TRANSLATED dispatch (a `rst 0x28` word-table jump through loc_0028) and the
 * TRANSLATED handlers through the routines map; the module dispatches to the IDIOMATIC handlers by
 * direct import. Because the ROM dispatch pops its inline table base before the tail jump, the
 * selected handler runs at the entry SP — so the oracle's SP delta is the handler's own (+2 for a
 * plain ret / continue, +4 for the `pop af; ret` caller-skip). The two must land byte-identical in
 * RAM (dumpState) minus stack scratch below the entry SP. No register is a live-out; only the boolean is compared.
 * Cases are CRAFTED: a plain boot does not seat these states.
 *
 * Jobs:
 *   1. EQUAL — each state routes to the right handler and path: state 0 animating (true) / reset
 *      (false), state 1 running (true) / expired (false), state 2 gate-closed and gate-open (true):
 *      oracle == module in RAM (−stack); boolean matches; oracle SP delta matches the path.
 *   2. WRITE-SET — state 1 expiry drives the reseed (only that handler writes it); state 0 reset
 *      reloads the shared phase countdown.
 *   3. TEETH — a mis-routed twin (state 1 handled as state 2) is caught by the RAM diff; an expiry
 *      reported as 'continue' (true) is rejected by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7638.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7638 as oracle } from "../../translated/loc_7638.js";
import { dispatchEnemyActorAnimTickState } from "../dispatchEnemyActorAnimTickState.js";
import { holdEnemyAnimGatedByDrawnFlag } from "../holdEnemyAnimGatedByDrawnFlag.js"; // for the mis-route teeth twin
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ae0; //     the entry being ticked (ix)
const STATE = REC + 0x02; // the state byte the dispatcher reads
const COUNTDOWN = 0x892e; // SHARED_PHASE_COUNTDOWN
const ENEMY_TABLE = 0x8ae0; // ENEMY_ACTOR_TABLE
const SUBSTATE = 0x8e51; // ATTRACT_SUBSTATE
const DRAWN = 0x8d58; //   OBJECT_DRAWN_FLAG (proposed cell)
const STRIDE = 0x18;
const SP0 = 0x8ff8;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function seatDispatch(state) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = SP0;
  m.mem.write8(REC + 0x0e, 0x05); // anim hold nonzero -> advanceObjectAnimationFrame just decrements (no ROM-script walk)
  m.mem.write8(STATE, state);
  return m;
}

/** state 0, live, frame stays >= 6 -> tickEnemyAnimAndReseedPoolAtCycleEnd animating (true). */
function craftState0Animating() {
  const m = seatDispatch(0x00);
  m.mem.write8(REC + 0x00, 0x01);
  m.mem.write8(REC + 0x05, 0x10);
  m.mem.write8(REC + 0x09, 0x04);
  m.mem.write8(REC + 0x06, 0x0a);
  return m;
}

/** state 0, live, frame drops below 6 -> tickEnemyAnimAndReseedPoolAtCycleEnd reset (false). */
function craftState0Reset() {
  const m = seatDispatch(0x00);
  m.mem.write8(REC + 0x00, 0x01);
  m.mem.write8(REC + 0x05, 0x02);
  m.mem.write8(REC + 0x09, 0x05); // borrow
  m.mem.write8(REC + 0x06, 0x06); // -> dec -> 5 (< 6)
  return m;
}

/** state 1, countdown running -> drainPhaseCountdownAndReseedWave decrement (true). */
function craftState1Running() {
  const m = seatDispatch(0x01);
  m.mem.write8(COUNTDOWN, 0x05);
  return m;
}

/** state 1, countdown expired -> drainPhaseCountdownAndReseedWave reseed (false). Reseed targets pre-set to known non-target
 * values so a mis-route (no reseed) diverges regardless of boot RAM. */
function craftState1Expired() {
  const m = seatDispatch(0x01);
  m.mem.write8(COUNTDOWN, 0x00);
  m.mem.write8(SUBSTATE, 0x00);
  for (let n = 0; n < 8; n++) m.mem.write8(ENEMY_TABLE + n * STRIDE + 0x02, 0x00);
  m.mem.write8(STATE, 0x01); // re-assert the dispatch state byte (the pre-seed loop's n=0 is REC+2)
  return m;
}

/** state 2, gate closed -> holdEnemyAnimGatedByDrawnFlag hold (true). */
function craftState2Closed() {
  const m = seatDispatch(0x02);
  m.mem.write8(DRAWN, 0x01);
  return m;
}

/** state 2, gate open -> holdEnemyAnimGatedByDrawnFlag step (true). */
function craftState2Open() {
  const m = seatDispatch(0x02);
  m.mem.write8(DRAWN, 0x00);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

for (const [label, craft, wantRet, spDelta] of [
  ["state 0 animating", craftState0Animating, true, 2],
  ["state 0 reset", craftState0Reset, false, 4],
  ["state 1 running", craftState1Running, true, 2],
  ["state 1 expired", craftState1Expired, false, 4],
  ["state 2 closed", craftState2Closed, true, 2],
  ["state 2 open", craftState2Open, true, 2],
]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack), ret ${wantRet}, SP+=${spDelta}`, () => {
    const o = craft();
    const c = craft();
    const ret = dispatchEnemyActorAnimTickState(c);
    oracle(o);
    assert.equal(ret, wantRet, `${label}: boolean must match the handler's path`);
    assert.equal(o.regs.sp, (SP0 + spDelta) & 0xffff, `${label}: oracle SP delta must be +${spDelta}`);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (${label})`);
    console.log(`  EQUAL ${label}: ret ${ret}, SP+=${spDelta}, RAM identical`);
  });
}

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: state 1 expiry drives the reseed; state 0 reset reloads the shared phase countdown", () => {
  const expired = craftState1Expired();
  oracle(expired);
  assert.equal(expired.mem.read8(ENEMY_TABLE + 0x02), 0x02, "state 1 expiry seeded enemy state byte to 2");
  assert.equal(expired.mem.read8(SUBSTATE), 0x08, "state 1 expiry set the attract sub-state to 8");

  const reset = craftState0Reset();
  oracle(reset);
  assert.equal(reset.mem.read8(COUNTDOWN), 0x20, "state 0 reset reloaded the shared phase countdown");
  console.log("  WRITE-SET: state routing reached the right handler effects");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a mis-routed twin (state 1 handled as state 2) is caught by the RAM diff", () => {
  const o = craftState1Expired();
  const c = craftState1Expired();
  oracle(o); // correct: routes state 1 -> drainPhaseCountdownAndReseedWave (reseed)
  holdEnemyAnimGatedByDrawnFlag(c); // BUG: a dispatcher that routed state 1 to the state-2 handler (no reseed)

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "gate FAILED to catch a mis-routed dispatch — worthless");
  assert.equal(d.addr, ENEMY_TABLE + 0x02, `teeth caught the mis-route at ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/route: a state-1-as-state-2 mis-route caught at ${hx(d.addr)}`);
});

test("TEETH: an expiry reported as 'continue' (true) is rejected by the boolean check", () => {
  function brokenContinue(m) {
    dispatchEnemyActorAnimTickState(m);
    return true; // BUG: a state-1 expiry must propagate false (abort the walk)
  }
  const c = craftState1Expired();
  assert.throws(
    () => assert.equal(brokenContinue(c), false),
    "the boolean contract must reject an expiry reported as 'continue'",
  );
  console.log("  TEETH/boolean: an expiry propagated as 'continue' is caught");
});

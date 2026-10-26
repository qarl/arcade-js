// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for drainPhaseCountdownAndReseedWave (ROM 0x7675, Pooyan) — animation-tick state 1, a DISSOLVED
 * caller-skip that composes the idiomatic advanceObjectAnimationFrame.
 *
 * It steps the entry's animation, then counts the shared phase countdown down. While that countdown
 * is non-zero it decrements it and takes the plain `ret` (SP += 2) returning true (the walk keeps
 * going). When it reaches zero it re-seeds the wave — the state byte of 8 enemy records set to 2, the
 * state byte of 6 object-state records cleared, the spawn ring counter cleared, the attract sub-state
 * set to 8 — then FALLS INTO `pop af; ret` (SP += 4) and returns false (abort the walk).
 *
 * The oracle drives the TRANSLATED advanceObjectAnimationFrame through the routines map; the module imports the
 * IDIOMATIC sibling directly. The two must land byte-identical in RAM (dumpState) minus stack scratch below the entry SP.
 * No register is a live-out — the caller reads back only the control-flow boolean — so registers are
 * NOT compared. The boolean return is, and the oracle's SP delta confirms which path ran. Cases are
 * CRAFTED: a plain boot does not seat this state.
 *
 * Jobs:
 *   1. EQUAL — timer running and timer expired: oracle == module in RAM (−stack); boolean matches;
 *      oracle SP delta matches the path.
 *   2. WRITE-SET — a timer-run tick decrements the countdown; an expiry seeds 8 enemy state bytes to
 *      2, clears 6 object-state bytes, clears the ring counter, sets the attract sub-state to 8.
 *   3. TEETH — a twin that reports the expiry as 'continue' (true) is rejected; a wrong seeded byte
 *      is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7675.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7675 as oracle } from "../../translated/loc_7638.js";
import { drainPhaseCountdownAndReseedWave } from "../drainPhaseCountdownAndReseedWave.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ae0; //     the entry being ticked (ix) — ENEMY_ACTOR_TABLE slot 0
const COUNTDOWN = 0x892e; // SHARED_PHASE_COUNTDOWN
const ENEMY_TABLE = 0x8ae0; // ENEMY_ACTOR_TABLE
const STATE_BASE = 0x8ba0; // OBJECT_STATE_RECORD_BASE
const RING = 0x8d57; //    SPAWN_RING_COUNTER (proposed cell)
const SUBSTATE = 0x8e51; // ATTRACT_SUBSTATE
const STRIDE = 0x18;
const SP0 = 0x8ff8; //     inside STACK_SCRATCH; room for the tick's nested call dip
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function seat(m) {
  m.regs.ix = REC;
  m.regs.sp = SP0;
  m.mem.write8(REC + 0x0e, 0x05); // anim hold nonzero -> advanceObjectAnimationFrame just decrements (no ROM-script walk)
  return m;
}

/** Countdown running -> decrement + plain ret. */
function craftRunning() {
  const m = seat(BASE.clone());
  m.mem.write8(COUNTDOWN, 0x05);
  return m;
}

/** Countdown at 0 -> the reseed + caller-skip. Records pre-set to known values so the seed is observable. */
function craftExpired() {
  const m = seat(BASE.clone());
  m.mem.write8(COUNTDOWN, 0x00);
  for (let n = 0; n < 8; n++) m.mem.write8(ENEMY_TABLE + n * STRIDE + 0x02, 0x00);
  for (let n = 0; n < 6; n++) m.mem.write8(STATE_BASE + n * STRIDE + 0x02, 0x77);
  m.mem.write8(RING, 0x33);
  m.mem.write8(SUBSTATE, 0x00);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: timer running — module == oracle in RAM (−stack), returns true, plain ret (SP+=2)", () => {
  const o = craftRunning();
  const c = craftRunning();
  const ret = drainPhaseCountdownAndReseedWave(c);
  oracle(o);
  assert.equal(ret, true, "a running countdown must return true (keep walking)");
  assert.equal(o.regs.sp, (SP0 + 2) & 0xffff, "oracle running must take the plain ret (SP += 2)");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL running: true, SP+=2, RAM identical");
});

test("EQUAL: timer expired — module == oracle in RAM (−stack), returns false, skip (SP+=4)", () => {
  const o = craftExpired();
  const c = craftExpired();
  const ret = drainPhaseCountdownAndReseedWave(c);
  oracle(o);
  assert.equal(ret, false, "an expiry must return false (abort the walk)");
  assert.equal(o.regs.sp, (SP0 + 4) & 0xffff, "oracle expiry must fall into pop-af/ret (SP += 4)");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL expired: false, SP+=4, RAM identical");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a running tick decrements the countdown", () => {
  const after = craftRunning();
  oracle(after);
  assert.equal(after.mem.read8(COUNTDOWN), 0x04, "running countdown decremented 5 -> 4");
  assert.equal(after.mem.read8(REC + 0x0e), 0x04, "animation hold decremented by the composed tick");
  console.log("  WRITE-SET: running decremented the countdown");
});

test("WRITE-SET: an expiry re-seeds the wave (8 states = 2, 6 cleared, ring = 0, sub-state = 8)", () => {
  const after = craftExpired();
  oracle(after);
  for (let n = 0; n < 8; n++) {
    assert.equal(after.mem.read8(ENEMY_TABLE + n * STRIDE + 0x02), 0x02, `enemy record ${n} state seeded to 2`);
  }
  for (let n = 0; n < 6; n++) {
    assert.equal(after.mem.read8(STATE_BASE + n * STRIDE + 0x02), 0x00, `object-state record ${n} cleared`);
  }
  assert.equal(after.mem.read8(RING), 0x00, "spawn ring counter cleared");
  assert.equal(after.mem.read8(SUBSTATE), 0x08, "attract sub-state set to 8");
  console.log("  WRITE-SET: expiry re-seeded the wave");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a twin that reports the expiry as 'continue' (true) is rejected by the boolean check", () => {
  function brokenContinue(m) {
    drainPhaseCountdownAndReseedWave(m);
    return true; // BUG: an expiry must abort the walk -> false
  }
  const c = craftExpired();
  assert.throws(
    () => assert.equal(brokenContinue(c), false),
    "the boolean contract must reject an expiry reported as 'continue'",
  );
  console.log("  TEETH/boolean: an expiry-returns-true twin is caught");
});

test("TEETH: a wrong seeded byte is caught by the RAM diff", () => {
  const o = craftExpired();
  const c = craftExpired();
  oracle(o);
  drainPhaseCountdownAndReseedWave(c);
  c.mem.write8(SUBSTATE, 0x99); // BUG: the expiry must set the sub-state to 8

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "gate FAILED to catch a wrong seeded byte — worthless");
  assert.equal(d.addr, SUBSTATE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong seeded byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

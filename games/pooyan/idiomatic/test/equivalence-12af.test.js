// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEnemyTravelAndSpawnChildActors (ROM 0x12af) — per-object travel tick driven off IX.
 *
 * Steps the record's animation, then branches on the record base at IX:
 *   - rec+0x08 already set -> delegate to the velocity mover (advanceActorPositionByVelocity);
 *   - else accumulate rec+0x05 += rec+0x09, carrying into rec+0x06;
 *   - STAGE_COUNTDOWN < 3 -> delegate to the spawn-cadence dispatch (dispatchActorSpawnBySubStateAndPaceCadence) with the accumulator;
 *   - else fetch this round's target column (ANIM_SEQ_TABLE_12FB via ROUND_COUNTER, then a byte via
 *     ANIM_FRAME_COUNTER): coarse == target -> child-spawn guard; coarse < 0x14 -> ret (travelling);
 *     coarse >= 0x14 -> latch rec+0x08 := 1 and restart the record on ANIM_TABLE_3838.
 *
 * This is the memory-equivalence gate: the routine WRITES RAM (its own record cells plus everything
 * the delegate chains touch), so every case uses a FRESH clone per side, compared on RAM (dumpState,
 * minus stack scratch below the entry SP) via firstStateDiff. pc/SP/cycles are NOT compared; advanceEnemyTravelAndSpawnChildActors has no load-
 * bearing register/return output of its own — it forwards each delegate's tail.
 *
 * Bridge input: ix (the record base). Every read field is crafted per case: the flag, the sub/step
 * accumulator, the coarse counter, the frame-hold (seated nonzero so the anim step is a plain
 * decrement), plus STAGE_COUNTDOWN / ROUND_COUNTER / ANIM_FRAME_COUNTER. The target column is
 * computed from the same ROM table both sides read, so the coarse counter can be aimed at each arm.
 *
 * Jobs: 1. EQUAL across all six branches; 2. WRITE-SET (accumulator, carry-into-coarse, the latch);
 * 3. TEETH (a corrupted accumulator is caught; the branches are load-bearing).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-12af.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_12af as oracle } from "../../translated/loc_12af.js";
import { advanceEnemyTravelAndSpawnChildActors } from "../advanceEnemyTravelAndSpawnChildActors.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  STAGE_COUNTDOWN,
  ROUND_COUNTER,
  ANIM_FRAME_COUNTER,
  ANIM_SEQ_TABLE_12FB,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const OFF_SUB = 0x05; //    sub-position accumulator
const OFF_COARSE = 0x06; // coarse position / lap counter
const OFF_FLAG = 0x08; //   latched-done flag
const OFF_STEP = 0x09; //   per-tick sub-position step
const OFF_VEL = 0x0a; //    velocity (read by the advanceActorPositionByVelocity delegate)
const OFF_HOLD = 0x0e; //   animation frame-hold (nonzero -> plain decrement)
const SP0 = 0x8fe0; //      inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** The target column advanceEnemyTravelAndSpawnChildActors fetches for (round, frame) — same ROM read both sides perform. */
function computeTarget(round, frame) {
  const off = ((((round & 0x1f) >> 2) << 1)) & 0xff;
  const wordPtr = (ANIM_SEQ_TABLE_12FB + off) & 0xffff;
  const word = BASE.mem.read8(wordPtr) | (BASE.mem.read8((wordPtr + 1) & 0xffff) << 8);
  return BASE.mem.read8((word + (frame & 0x0f)) & 0xffff);
}

function craft({ ix, flag, sub, step, coarse, vel = 0x00, countdown, round = 0x00, frame = 0x00 }) {
  const m = BASE.clone();
  m.regs.ix = ix & 0xffff;
  m.regs.sp = SP0;
  m.mem.write8((ix + OFF_FLAG) & 0xffff, flag & 0xff);
  m.mem.write8((ix + OFF_SUB) & 0xffff, sub & 0xff);
  m.mem.write8((ix + OFF_STEP) & 0xffff, step & 0xff);
  m.mem.write8((ix + OFF_COARSE) & 0xffff, coarse & 0xff);
  m.mem.write8((ix + OFF_VEL) & 0xffff, vel & 0xff);
  m.mem.write8((ix + OFF_HOLD) & 0xffff, 0x04); // hold nonzero -> anim step is a plain decrement
  m.mem.write8(STAGE_COUNTDOWN, countdown & 0xff);
  m.mem.write8(ROUND_COUNTER, round & 0xff);
  m.mem.write8(ANIM_FRAME_COUNTER, frame & 0xff);
  return m;
}

const T00 = ROM_PRESENT ? computeTarget(0x00, 0x00) : 0; // target round0/frame0 (ROM-guarded: skip path)

const CASES = [
  { name: "flagged -> advanceActorPositionByVelocity mover", ix: 0x8300, flag: 0x01, sub: 0x40, step: 0x10, coarse: 0x05, vel: 0xe0, countdown: 0x05 },
  { name: "no-carry, stage<3 -> dispatchActorSpawnBySubStateAndPaceCadence", ix: 0x8320, flag: 0x00, sub: 0x10, step: 0x05, coarse: 0x03, countdown: 0x01 },
  { name: "carry -> inc coarse, stage<3 -> dispatchActorSpawnBySubStateAndPaceCadence", ix: 0x8340, flag: 0x00, sub: 0xf0, step: 0x20, coarse: 0x08, countdown: 0x02 },
  { name: "stage>=3, coarse==target -> spawn guard", ix: 0x8360, flag: 0x00, sub: 0x10, step: 0x05, coarse: T00, vel: 0x00, countdown: 0x05, round: 0x00, frame: 0x00 },
  { name: "stage>=3, coarse<0x14 -> travelling ret", ix: 0x8380, flag: 0x00, sub: 0x10, step: 0x05, coarse: (T00 + 1) & 0xff, countdown: 0x05, round: 0x00, frame: 0x00 },
  { name: "stage>=3, coarse>=0x14 -> latch + setAnim", ix: 0x83a0, flag: 0x00, sub: 0x10, step: 0x05, coarse: 0x18, countdown: 0x05, round: 0x00, frame: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted records — advanceEnemyTravelAndSpawnChildActors == oracle in RAM (−stack)", () => {
  // The two coarse<0x14 / >=0x14 cases must actually differ from the target, or their arms collapse.
  assert.notEqual((T00 + 1) & 0xff, T00, "sanity: travelling case must differ from target");
  assert.notEqual(0x18, T00, "sanity: latch case must differ from target");
  assert.ok(T00 < 0x14, "sanity: target/travelling pokes stay under the 0x14 latch threshold");

  for (const cs of CASES) {
    const o = craft(cs);
    const c = craft(cs);
    oracle(o);
    advanceEnemyTravelAndSpawnChildActors(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(
      d,
      null,
      d && `${cs.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (ix=${hx(cs.ix)})`,
    );
  }
  console.log(`  EQUAL: ${CASES.length} crafted branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: accumulator advances, carry bumps coarse, the end-arm latches the flag", () => {
  // no-carry accumulate: rec+0x05 := (sub+step)&0xff; coarse unchanged
  const nc = CASES[1];
  const c1 = craft(nc);
  advanceEnemyTravelAndSpawnChildActors(c1);
  assert.equal(c1.mem.read8(nc.ix + OFF_SUB), (nc.sub + nc.step) & 0xff, "accumulator stored");
  assert.equal(c1.mem.read8(nc.ix + OFF_COARSE), nc.coarse & 0xff, "no carry -> coarse unchanged");

  // carry accumulate: coarse incremented by one
  const cy = CASES[2];
  assert.ok(cy.sub + cy.step > 0xff, "sanity: carry case must overflow");
  const c2 = craft(cy);
  advanceEnemyTravelAndSpawnChildActors(c2);
  assert.equal(c2.mem.read8(cy.ix + OFF_SUB), (cy.sub + cy.step) & 0xff, "accumulator stored (carry)");
  assert.equal(c2.mem.read8(cy.ix + OFF_COARSE), (cy.coarse + 1) & 0xff, "carry -> coarse incremented");

  // end arm: flag latched to 1
  const lt = CASES[5];
  const c3 = craft(lt);
  assert.equal(c3.mem.read8(lt.ix + OFF_FLAG), 0x00, "flag starts clear");
  advanceEnemyTravelAndSpawnChildActors(c3);
  assert.equal(c3.mem.read8(lt.ix + OFF_FLAG), 0x01, "end arm latches the flag");
  console.log("  WRITE-SET: rec+0x05 := (sub+step)&0xff; coarse += carry; end arm latches rec+0x08");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted accumulator is CAUGHT; branches are load-bearing", () => {
  const cs = CASES[1];
  const o = craft(cs);
  const c = craft(cs);
  oracle(o);
  advanceEnemyTravelAndSpawnChildActors(c);
  const subAddr = (cs.ix + OFF_SUB) & 0xffff;
  c.mem.write8(subAddr, (c.mem.read8(subAddr) ^ 0xff) & 0xff); // BUG: wrong accumulator byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted accumulator — it is worthless");
  assert.equal(d.addr, subAddr, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(subAddr)})`);

  // the travelling arm and the latch arm must diverge, or a guard is dead
  const trav = craft(CASES[4]);
  const latch = craft(CASES[5]);
  oracle(trav);
  oracle(latch);
  assert.notEqual(ramDiffMinusStack(trav, latch), null, "travelling and latch arms must differ");
  console.log(`  TEETH: corrupted accumulator caught at ${hx(d.addr)}; travelling vs latch arms differ`);
});

// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEagleStageTimersAndLatchMoveElseRearm (ROM 0x57c6, Pooyan) — the eagle sub-state stepper / re-arm.
 * With the step counter in 1..6 it bumps the counter and steps the first non-zero of three stage
 * timers, latching a move dir+speed into the actor record (rec+0x13 / rec+0x16). A zero or
 * exhausted counter re-arms: reset to 1, pick a record table by the round flag's bit0, index it by
 * 3x a clamped position, copy three bytes into the stage timers, and re-run the state head (a tail
 * that recurses back through the head into the advance path).
 *
 * SEATING: BALANCED — every stage exit is a plain ret and the re-arm exit is a tail-jp reusing the
 * caller's frame; no net SP move, so the routine WIREs. LIVE-OUT is none: the caller pops+discards
 * AF after the call, so no register survives; equivalence is RAM (dumpState) minus stack scratch below the entry SP,
 * SP parked in STACK_SCRATCH so the re-arm/recursion pushes drop out.
 *
 * The advance cases are self-contained (no sub-call). The re-arm case tails through the state head
 * and back into the advance path, so it also exercises that recursion end-to-end.
 *
 * Cases are CRAFTED: a plain boot does not seat the counter + stage timers + actor record.
 *
 * Jobs:
 *   1. EQUAL — the three stage steps, the idle-stage step, and a bit0-clear re-arm: oracle == module.
 *   2. WRITE-SET — stage 1 leaves the expected dir/speed latch; the idle stage writes no latch.
 *   3. TEETH — a corrupted latch byte is caught by the RAM diff; a twin that skips the stage
 *      decrement diverges at the stage-timer footprint.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-57c6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_57c6 as oracle } from "../../translated/loc_57c6.js";
import { advanceEagleStageTimersAndLatchMoveElseRearm } from "../advanceEagleStageTimersAndLatchMoveElseRearm.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const COUNTER = 0x8d46; // EAGLE_STEP_COUNTER
const STAGES = 0x8d47; // EAGLE_STAGE_TIMERS (three bytes)
const ROUND = 0x8907; // ROUND_COUNTER (bit0 selects the re-arm table)
const IX = 0x8840; // actor record base
const DIR = IX + 0x13; // rec+0x13 move-dir latch
const SPD = IX + 0x16; // rec+0x16 move-speed latch
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat IX + a clean record window; caller supplies the counter and the three stage timers. */
function seat(m, { counter, s0 = 0, s1 = 0, s2 = 0, round = 0x00 } = {}) {
  m.regs.sp = SP0;
  m.regs.ix = IX;
  for (let i = 0; i < 0x18; i++) m.mem.write8(IX + i, 0x00);
  m.mem.write8(COUNTER, counter);
  m.mem.write8(STAGES + 0, s0);
  m.mem.write8(STAGES + 1, s1);
  m.mem.write8(STAGES + 2, s2);
  m.mem.write8(ROUND, round);
  return m;
}

const craftStage1 = () => seat(BASE.clone(), { counter: 0x01, s0: 0x03 });
const craftStage2 = () => seat(BASE.clone(), { counter: 0x02, s0: 0x00, s1: 0x04 });
const craftStage3 = () => seat(BASE.clone(), { counter: 0x03, s0: 0x00, s1: 0x00, s2: 0x05 });
const craftIdle = () => seat(BASE.clone(), { counter: 0x04, s0: 0x00, s1: 0x00, s2: 0x00 });
// re-arm: counter 0, even round -> the bit0-clear table; recurses through the head into advance.
const craftReArm = () => seat(BASE.clone(), { counter: 0x00, round: 0x04 });

const CASES = [
  { name: "stage 1 step", craft: craftStage1 },
  { name: "stage 2 step", craft: craftStage2 },
  { name: "stage 3 step", craft: craftStage3 },
  { name: "idle stage (counter bumps only)", craft: craftIdle },
  { name: "re-arm (bit0 clear) + recursion", craft: craftReArm },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceEagleStageTimersAndLatchMoveElseRearm == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    advanceEagleStageTimersAndLatchMoveElseRearm(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: stage 1 latches dir/speed; the idle stage writes no latch", () => {
  const s1 = craftStage1();
  oracle(s1);
  assert.equal(s1.mem.read8(DIR), 0x02, "stage 1 latches dir");
  assert.equal(s1.mem.read8(SPD), 0x01, "stage 1 latches speed");
  assert.equal(s1.mem.read8(COUNTER), 0x02, "the step counter bumps");
  assert.equal(s1.mem.read8(STAGES + 0), 0x02, "stage 1 timer decremented");

  const idle = craftIdle();
  oracle(idle);
  assert.equal(idle.mem.read8(DIR), 0x00, "the idle stage leaves the dir latch untouched");
  assert.equal(idle.mem.read8(COUNTER), 0x05, "the idle stage still bumps the counter");
  console.log("  WRITE-SET: stage 1 latches; idle bumps counter only");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted latch byte is CAUGHT by the RAM diff", () => {
  const o = craftStage1();
  const c = craftStage1();
  oracle(o);
  advanceEagleStageTimersAndLatchMoveElseRearm(c);
  c.mem.write8(DIR, (o.mem.read8(DIR) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted latch byte");
  assert.equal(d.addr, DIR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the stage decrement diverges at the stage timer", () => {
  const o = craftStage3();
  const twin = craftStage3();
  oracle(o);
  advanceEagleStageTimersAndLatchMoveElseRearm(twin);
  twin.mem.write8(STAGES + 2, twin.mem.read8(STAGES + 2) + 1); // undo the decrement
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a missing stage decrement — worthless");
  assert.equal(d.addr, STAGES + 2, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(STAGES + 2)})`);
  console.log(`  TEETH(skip-dec): caught at ${hx(d.addr)}`);
});

// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runPerFrameObjectSubPasses (ROM 0x68f8, Pooyan) — per-frame group update: run the
 * four object sub-passes in order (delay-gated enemy-spawn sweep, paired descending-object
 * stepper, enemy-spawn sweep driver, per-frame object driver) then return.
 *
 * The module calls the four idiomatic siblings directly; the oracle drives the four translated
 * siblings through the routines map. runPerFrameObjectSubPasses is a void sequencer — no register survives, so the
 * register file is not compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP. SP is parked
 * in STACK_SCRATCH so each sub-pass's nested pushes drop out of the diff.
 *
 * The first and third sub-passes carry a dissolved caller-skip whose translated form over-spawns
 * (documented in their own gates), so the crafted states keep those two in their agreement region:
 * the frame-delay timer and the blink countdown are both left running, so each merely decrements
 * and returns before its record sweep. That isolates runPerFrameObjectSubPasses's own job — ORDER + WIRING — from
 * the sub-passes' internals, which their own equivalence gates cover.
 *
 * Jobs:
 *   1. EQUAL/GATED — timer + countdown running, empty records: only the two counters tick;
 *      oracle == module in RAM (−stack).
 *   2. EQUAL/RICH — the same gates, plus one descending record for the stepper and one active
 *      record for the object driver, so all four passes act observably: oracle == module in RAM.
 *   3. TEETH — a twin sequencer missing any one of the four passes diverges from the oracle at
 *      that pass's footprint (timer, stepped position, countdown, driver record).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-68f8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_68f8 as oracle } from "../../translated/loc_68f8.js";
import { runPerFrameObjectSubPasses } from "../runPerFrameObjectSubPasses.js";
import { spawnPairedEnemyOnDelaySweep } from "../spawnPairedEnemyOnDelaySweep.js";
import { stepPairedDescendingObjects } from "../stepPairedDescendingObjects.js";
import { spawnEnemyOnBlinkCountdownSweep } from "../spawnEnemyOnBlinkCountdownSweep.js";
import { runObjectsElseVerifyTilemapChecksum } from "../runObjectsElseVerifyTilemapChecksum.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const DELAY = 0x8929; // SHARED_FRAME_DELAY_TIMER
const COUNTDOWN = 0x892a; // BLINK_COUNTDOWN
const PHASE = 0x892b; // BLINK_PHASE
const TOGGLE = 0x892c; // ANIM_PHASE_TOGGLE_892C
const WAVE = 0x892d; // WAVE_NUMBER
const EAT = 0x8ae0; // ENEMY_ACTOR_TABLE
const OSR = 0x8ba0; // OBJECT_STATE_RECORD_BASE
const STRIDE = 0x18;
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Gate the two over-spawning sweeps to their decrement-and-return branch. */
function gate(m) {
  m.regs.sp = SP0;
  m.mem.write8(DELAY, 0x05); // timer running -> first sweep just decrements
  m.mem.write8(PHASE, 0x01); // blink phase set -> object driver walks records, driver branch below
  m.mem.write8(TOGGLE, 0x00); // toggle != gate value
  m.mem.write8(COUNTDOWN, 0x07); // countdown running -> sweep driver just decrements
  m.mem.write8(WAVE, 0x00); // not the integrity wave (blink phase set makes that moot anyway)
  return m;
}

function craftGated() {
  return gate(BASE.clone());
}

function craftRich() {
  const m = gate(BASE.clone());
  // stepper: EAT rec0 active(+0) idle(+2), +1 clear so the object driver skips it; descending high
  m.mem.write8(EAT + 0 * STRIDE + 0, 0x01);
  m.mem.write8(EAT + 0 * STRIDE + 1, 0x00);
  m.mem.write8(EAT + 0 * STRIDE + 2, 0x00);
  m.mem.write8(EAT + 0 * STRIDE + 5, 0x20);
  m.mem.write8(EAT + 0 * STRIDE + 6, 0x10); // high != 0 and != gate -> keep descending
  m.mem.write8(EAT + 0 * STRIDE + 9, 0x04);
  m.mem.write8(OSR + 0 * STRIDE + 5, 0x30);
  m.mem.write8(OSR + 0 * STRIDE + 6, 0x10);
  m.mem.write8(OSR + 0 * STRIDE + 9, 0x03);
  // object driver: EAT rec10 active(+1), state (+2)=1 -> the benign step handler
  m.mem.write8(EAT + 10 * STRIDE + 1, 0x01);
  m.mem.write8(EAT + 10 * STRIDE + 2, 0x01);
  return m;
}

// -- 1 & 2. EQUAL -------------------------------------------------------------

for (const [label, craft] of [["gated (counters only)", craftGated], ["rich (all four act)", craftRich]]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack)`, () => {
    const o = craft();
    const c = craft();
    oracle(o);
    runPerFrameObjectSubPasses(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    console.log(`  EQUAL ${label}: RAM identical`);
  });
}

// -- 3. TEETH -----------------------------------------------------------------

const DROPS = [
  { name: "drop 6905 (timer sweep)", keep: [stepPairedDescendingObjects, spawnEnemyOnBlinkCountdownSweep, runObjectsElseVerifyTilemapChecksum], addr: DELAY },
  { name: "drop 69ad (stepper)", keep: [spawnPairedEnemyOnDelaySweep, spawnEnemyOnBlinkCountdownSweep, runObjectsElseVerifyTilemapChecksum], addr: EAT + 0 * STRIDE + 5 },
  { name: "drop 6a0f (sweep driver)", keep: [spawnPairedEnemyOnDelaySweep, stepPairedDescendingObjects, runObjectsElseVerifyTilemapChecksum], addr: COUNTDOWN },
  { name: "drop 6a7f (object driver)", keep: [spawnPairedEnemyOnDelaySweep, stepPairedDescendingObjects, spawnEnemyOnBlinkCountdownSweep], addr: EAT + 10 * STRIDE + 2 },
];

test("TEETH: a sequencer missing any one pass diverges from the oracle at that pass's footprint", () => {
  for (const { name, keep, addr } of DROPS) {
    const o = craftRich();
    const twin = craftRich();
    oracle(o);
    for (const pass of keep) pass(twin); // a broken sequencer that omits exactly one pass
    const d = ramDiffMinusStack(o, twin);
    assert.notEqual(d, null, `${name}: the gate FAILED to catch a missing pass — worthless`);
    assert.equal(d.addr, addr, `${name}: teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(addr)})`);
    console.log(`  TEETH ${name}: caught at ${hx(d.addr)}`);
  }
});

// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stepGameplayFrame (ROM 0x19ee, Pooyan) — the gameplay-state per-frame
 * coordinator: six ordered sub-drivers, then return.
 *
 * The module direct-calls the six idiomatic sub-drivers; the oracle drives the same six frozen
 * routines through the registry new Machine(ROM) builds. stepGameplayFrame is a void driver — no register
 * survives — so the register file is not compared; equivalence is RAM (dumpState) minus
 * stack scratch below the entry SP, SP parked in dead stack so nested pushes drop out.
 *
 * The crafted state holds the sub-drivers on benign arms: the formation disabled, an even round so
 * the secondary-state driver forces the play sub-state and returns. The coordinator's own job — run
 * all six, in order — is what the whole-RAM diff proves.
 *
 * Jobs:
 *   1. EQUAL — oracle == stepGameplayFrame in RAM (−stack).
 *   2. WRITE-SET — the run is not inert: the secondary-state driver forces the play sub-state to 6.
 *   3. TEETH — a wrong play-sub-state byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-19ee.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_19ee as oracle } from "../../translated/loc_19ee.js";
import { stepGameplayFrame } from "../stepGameplayFrame.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FORMATION_ENABLE = 0x8f04; // formation manager gate (0 -> disabled)
const ROUND = 0x8907; //           round counter (even -> secondary driver forces the play sub-state)
const PLAY_STATE = 0x880a; //      play sub-state index
const SP0 = 0x8ff0; //             inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with every sub-driver on a benign arm. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[FORMATION_ENABLE] = 0x00; // formation disabled -> its manager returns at once
  m.mem8[ROUND] = 0x00; //           even round -> the secondary driver forces the play sub-state
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: stepGameplayFrame == oracle in RAM (−stack)", () => {
  const a = craft();
  const b = craft();
  oracle(a);
  stepGameplayFrame(b);
  const d = ramDiffMinusStack(a, b);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: coordinator identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the coordinator runs its sub-drivers (play sub-state forced to 6)", () => {
  const before = craft();
  const snap = before.dumpState();
  const run = craft();
  oracle(run);
  assert.equal(run.mem8[PLAY_STATE], 0x06, "even round -> secondary driver forced the play sub-state to 6");
  assert.notDeepEqual([...run.dumpState()], [...snap], "the coordinator must not be inert");
  console.log("  WRITE-SET: play sub-state forced to 6; RAM changed");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong play-sub-state byte is CAUGHT by the RAM diff", () => {
  const a = craft();
  const b = craft();
  oracle(a);
  stepGameplayFrame(b);
  b.mem8[PLAY_STATE] = (a.mem8[PLAY_STATE] ^ 0xff) & 0xff; // corrupt the sequenced write
  const d = ramDiffMinusStack(a, b);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong play-sub-state byte — worthless");
  assert.equal(d.addr, PLAY_STATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong play-sub-state byte caught at ${hx(d.addr)}`);
});

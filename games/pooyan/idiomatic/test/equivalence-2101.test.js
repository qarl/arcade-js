// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runLaunchAndTargetActorPipeline (ROM 0x2101, Pooyan) — the boot-frontier sub-dispatch: run
 * the three frontier sub-passes in order (the launch-sequence state driver 0x2778, the one-shot
 * slot-arming advance 0x210b, the paired-slot integrity scan 0x2157) then return.
 *
 * The module calls the three idiomatic siblings directly; the oracle drives the three translated
 * siblings through the routines map. runLaunchAndTargetActorPipeline is a void sequencer — no register survives, so the
 * register file is not compared (dumpState is memory-only); equivalence is RAM minus stack scratch below the entry SP,
 * with SP parked there so each sub-pass's nested pushes drop out of the diff.
 *
 * The crafted state pins each sub-pass to a small, DISJOINT footprint so ORDER + WIRING is isolated
 * from the sub-passes' internals (which their own equivalence gates cover):
 *   - 0x2778 dispatches launch state 0 to a handler that only arms two frontier latches (0x8f20,
 *     0x8f3f) then bails on a below-threshold arrow Y — no blit path.
 *   - 0x210b sees the trigger bit clear, so it just clears the player-aim flags (0x8a87) and rets.
 *   - 0x2157 finds both paired slots idle, so it only ticks its pass counter (0x8f15) to 1.
 *
 * Jobs:
 *   1. EQUAL — oracle == module in RAM (−stack).
 *   2. TEETH — a twin sequencer missing any one pass diverges from the oracle at that pass's
 *      footprint (0x8f20 for 0x2778, 0x8a87 for 0x210b, 0x8f15 for 0x2157).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2101.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2101 as oracle } from "../../translated/loc_2101.js";
import { runLaunchAndTargetActorPipeline } from "../runLaunchAndTargetActorPipeline.js";
import { dispatchLaunchState } from "../dispatchLaunchState.js";
import { spawnTargetActorOnLaunchTrigger } from "../spawnTargetActorOnLaunchTrigger.js";
import { stepActiveTargetActorRecords } from "../stepActiveTargetActorRecords.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const LAUNCH_STATE = 0x8f30; // dispatch index (low 3 bits) for 0x2778
const LAUNCH_ARMED = 0x8f3f; // 0x2778 handler-0 arming latch (0 -> not-armed write path)
const LAUNCH_GATE = 0x8d75; // handler-0 precondition (non-zero -> inc-latch branch)
const FRONTIER_LATCH = 0x8f20; // handler-0 bumps this from 0 -> 1  (0x2778 footprint)
const ARROW_Y = 0x8ab4; // < 0x3c makes handler-0 bail before any blit
const AIM_FLAGS = 0x8a87; // (ix+7); 0x210b clears it 0x01 -> 0x00  (0x210b footprint)
const SLOT0 = 0x8c90; // paired-slot base; bit0 clear -> idle
const SLOT1 = 0x8ca8; // 0x8c90 + 0x18
const PASS_TALLY = 0x8f15; // 0x2157 leaves this at 1  (0x2157 footprint)
const TAMPER_CELL = 0x8f00; // 0x2157 reads it; 0xd5 makes the checksum match (no tail branch)
const LATCH_8f02 = 0x8f02; // 0x2157 writes 0 here; pre-seeded 0 so that write is a no-op
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat all three passes onto small, disjoint footprints. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  // 0x2778 -> handler 0: arm 0x8f20/0x8f3f, then bail (arrow Y below threshold), no blit.
  m.mem.write8(LAUNCH_STATE, 0x00);
  m.mem.write8(LAUNCH_ARMED, 0x00);
  m.mem.write8(LAUNCH_GATE, 0x01);
  m.mem.write8(FRONTIER_LATCH, 0x00);
  m.mem.write8(ARROW_Y, 0x00);
  // 0x210b: trigger bit4 clear -> clear aim flags and ret.
  m.mem.write8(AIM_FLAGS, 0x01);
  // 0x2157: both slots idle, checksum matches -> only the pass tally ticks.
  m.mem.write8(SLOT0, 0x00);
  m.mem.write8(SLOT1, 0x00);
  m.mem.write8(PASS_TALLY, 0x00);
  m.mem.write8(TAMPER_CELL, 0xd5);
  m.mem.write8(LATCH_8f02, 0x00);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: module == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  runLaunchAndTargetActorPipeline(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: RAM identical");
});

// -- 2. TEETH -----------------------------------------------------------------

const DROPS = [
  { name: "drop 2778 (launch driver)", keep: [spawnTargetActorOnLaunchTrigger, stepActiveTargetActorRecords], addr: FRONTIER_LATCH },
  { name: "drop 210b (slot-arming advance)", keep: [dispatchLaunchState, stepActiveTargetActorRecords], addr: AIM_FLAGS },
  { name: "drop 2157 (integrity scan)", keep: [dispatchLaunchState, spawnTargetActorOnLaunchTrigger], addr: PASS_TALLY },
];

test("TEETH: a sequencer missing any one pass diverges from the oracle at that pass's footprint", () => {
  for (const { name, keep, addr } of DROPS) {
    const o = craft();
    const twin = craft();
    oracle(o);
    for (const pass of keep) pass(twin); // a broken sequencer that omits exactly one pass
    const d = ramDiffMinusStack(o, twin);
    assert.notEqual(d, null, `${name}: the gate FAILED to catch a missing pass — worthless`);
    assert.equal(d.addr, addr, `${name}: teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(addr)})`);
    console.log(`  TEETH ${name}: caught at ${hx(d.addr)}`);
  }
});

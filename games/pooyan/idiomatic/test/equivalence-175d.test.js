// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for startRoundAfterIntroDelay (ROM 0x175d, Pooyan) — the play sub-state idx2 handler. It
 * runs the display-list interpreter, advances SUBPHASE_TICK (wrapping every 0x1c calls) and a
 * one-shot at FORMATION_SLOT_TABLE, then picks an action from PLAY_MODE_LATCH / ROUND_IN_PROGRESS /
 * GAME_ACTIVE_FLAG / ROUND_COUNTER: arm sub-state 0x0d, or run the level-start batch and force
 * sub-state 3.
 *
 * The module dissolves paintDisplayListRunToVram, paintPhaseGauge, paintSpawnPhaseMarkerColumn and rebuildSpriteDisplayList to direct calls and keeps
 * push16 + m.call for the two unlifted batch callees (0x1ead, 0x540d); the oracle drives the same
 * frozen routines. startRoundAfterIntroDelay is a void handler — no register survives — so equivalence is RAM
 * (dumpState) minus stack scratch below the entry SP, SP parked in dead stack.
 *
 * paintDisplayListRunToVram runs on every arm, so a benign RELOAD display-list stream is seated (both pointer pairs)
 * so it breaks at once without a ROM write. Arms: an early return (tick not at wrap), the arm-0x0d
 * branch, the force-sub-3 branch, and the level-start batch branch.
 *
 * Jobs:
 *   1. EQUAL — early / arm-0x0d / force-3 / batch arms: oracle == startRoundAfterIntroDelay in RAM (−stack).
 *   2. WRITE-SET — the branch choice is observable at PLAY_STATE_INDEX (0x0d vs 0x03).
 *   3. TEETH — a wrong PLAY_STATE_INDEX is CAUGHT by the RAM diff.
 *   4. SP-TOOTH — both the batch arm and the light arm are seam-placeable (moved 0).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-175d.test.js
 */
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_175d as oracle } from "../../translated/loc_175d.js";
import { startRoundAfterIntroDelay } from "../startRoundAfterIntroDelay.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SUBTICK = 0x88b7; //  SUBPHASE_TICK (wraps at 0x1c)
const ONESHOT = 0x8920; //  FORMATION_SLOT_TABLE (multiplexed one-shot here)
const LATCH = 0x8f50; //    PLAY_MODE_LATCH
const INPROG = 0x8904; //   ROUND_IN_PROGRESS
const ACTIVE = 0x8806; //   GAME_ACTIVE_FLAG
const ROUND = 0x8907; //    ROUND_COUNTER
const SUBSTATE = 0x880a; // PLAY_STATE_INDEX (the output byte)
const STREAM = 0x8000; //   RELOAD display-list stream + both pointer targets
const SP0 = 0x8ff0; //      inside STACK_SCRATCH
const CALLER_RET = 0xfffc;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat a benign display-list: a RELOAD opcode so paintDisplayListRunToVram breaks at once, no ROM write. */
function seatDisplayList(m) {
  m.mem8[STREAM] = 0xff; //     RELOAD
  m.mem8[STREAM + 1] = 0x00;
  m.mem8[STREAM + 2] = 0x00;
  m.mem8[STREAM + 3] = 0x00; // tick += 0
  m.mem.write16(0x8f43, STREAM); // DISPLAY_LIST_DST_PTR
  m.mem.write16(0x8f45, STREAM); // DISPLAY_LIST_SRC_PTR
  m.mem.write16(0x88b8, STREAM); // DISPLAY_LIST_DST_PTR_ALT
  m.mem.write16(0x88ba, STREAM); // DISPLAY_LIST_SRC_PTR_ALT
}

function craft(variant) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  seatDisplayList(m);
  m.mem8[0x881e] = 0x00; // valid-ROM path for paintRoundNumberHud
  if (variant === "early") {
    m.mem8[SUBTICK] = 0x00; // inc -> 1 != 0x1c -> early return
    m.mem8[ONESHOT] = 0x00;
    return m;
  }
  m.mem8[SUBTICK] = 0x1b; // inc -> 0x1c (wrap)
  m.mem8[ONESHOT] = 0x01; // armed (!=0) -> clear + proceed
  m.mem8[LATCH] = variant === "force3" ? 0x01 : 0x00;
  m.mem8[INPROG] = variant === "batch" ? 0x01 : 0x00;
  m.mem8[ACTIVE] = 0x01; //  active (arm-0x0d path needs GAME_ACTIVE != 0)
  m.mem8[ROUND] = variant === "arm" ? 0x01 : 0x00; // arm: bit0 set -> 0x0d; else even
  return m;
}

const ARMS = ["early", "arm", "force3", "batch"];

// -- 1. EQUAL -----------------------------------------------------------------
test("EQUAL: early / arm / force3 / batch — startRoundAfterIntroDelay == oracle in RAM (−stack)", () => {
  for (const variant of ARMS) {
    const o = craft(variant); oracle(o);
    const c = craft(variant); startRoundAfterIntroDelay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${variant}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: all four arms identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------
test("WRITE-SET: the branch choice lands in PLAY_STATE_INDEX", () => {
  const arm = craft("arm"); oracle(arm);
  assert.equal(arm.mem8[SUBSTATE], 0x0d, "arm branch -> sub-state 0x0d");

  const force3 = craft("force3"); oracle(force3);
  assert.equal(force3.mem8[SUBSTATE], 0x03, "force-3 branch -> sub-state 0x03");

  assert.notEqual(arm.mem8[SUBSTATE], force3.mem8[SUBSTATE], "the branch must choose the sub-state");
  console.log("  WRITE-SET: arm -> 0x0d, force3 -> 0x03");
});

// -- 3. TEETH -----------------------------------------------------------------
test("TEETH: a wrong PLAY_STATE_INDEX is CAUGHT by the RAM diff", () => {
  const o = craft("arm"); const c = craft("arm");
  oracle(o); startRoundAfterIntroDelay(c);
  c.mem8[SUBSTATE] = 0x03; // BUG: the arm branch must set 0x0d
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong sub-state — it is worthless");
  assert.equal(d.addr, SUBSTATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong sub-state caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH (R36) --------------------------------------------------------
test("SP-TOOTH: both the batch and light arms are seam-placeable (moved 0)", () => {
  const batch = seamPlaceable(withOmittedRet, startRoundAfterIntroDelay, 0x175d, craft("batch"));
  assert.equal(batch.placeable, true, `batch arm must be seam-placeable; got: ${batch.error}`);
  const arm = seamPlaceable(withOmittedRet, startRoundAfterIntroDelay, 0x175d, craft("arm"));
  assert.equal(arm.placeable, true, `light arm must be seam-placeable; got: ${arm.error}`);
  console.log("  SP-TOOTH: batch + light arm both placeable (moved 0)");
});

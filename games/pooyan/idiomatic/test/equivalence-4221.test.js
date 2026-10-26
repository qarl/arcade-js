// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for moveFormationAndSpawnObject (ROM 0x4221, Pooyan) — the per-frame object-state handler.
 *
 * The idiomatic module direct-calls its lifted callees (advanceObjectAnimationFrame/advanceObjectColumnByStepAndDispatch/advanceActorColumnAndArmTurnOrBand/blankActorSpriteBand, the
 * interior-entry arms clearColumnLimitAndArmTurnAnimation/latchColumnLimitAndArmTurnAnimation, and blockC9's slot initializer initDescendingObjectSlot — a caller-skip
 * dissolved to a boolean the sweep early-returns on). moveFormationAndSpawnObject is a dispatched void handler — no
 * register survives — so equivalence is RAM (dumpState) minus stack scratch below the entry SP.
 *
 * Two branch-representative arms: TURN_CLEAR (bit0 clear, phase >= 0x14 -> clearColumnLimitAndArmTurnAnimation arms script 0x4212
 * and clears the turn-column limit) and TURN_LATCH (bit0 set, small phase, countdown high -> latchColumnLimitAndArmTurnAnimation
 * arms script 0x4203 and latches the limit to 0xff). A crafted SP-tooth drives the blockC9 sweep on
 * its skip path and asserts moveFormationAndSpawnObject seats SP for the seam.
 *
 * Jobs:
 *   1. EQUAL — both arms: oracle == moveFormationAndSpawnObject in RAM (−stack).
 *   2. WRITE-SET — the two arms drive the turn-column limit oppositely (0x00 vs 0xff).
 *   3. TEETH — a wrong turn-column limit is CAUGHT by the RAM diff.
 *   4. SP-TOOTH — moveFormationAndSpawnObject is seam-placeable (moved 0, sub-calls direct, seam supplies the ret).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-4221.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4221 as oracle } from "../../translated/loc_4221.js";
import { moveFormationAndSpawnObject } from "../moveFormationAndSpawnObject.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ENEMY_ACTOR_TABLE,
  TURN_COLUMN_LIMIT,
  STAGE_COUNTDOWN,
  SPAWN_SWEEP_TRIGGER,
  SPAWN_OBJECT_TABLE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = ENEMY_ACTOR_TABLE; //  the actor record moveFormationAndSpawnObject works on
const SP0 = 0x8fe0; //             inside STACK_SCRATCH
const CALLER_RET = 0xfffc; //      caller-return word the seam completes

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Common record seating: animation held (advanceObjectAnimationFrame just ticks), movement callee returns early. */
function seatRecord(m) {
  m.regs.sp = SP0;
  m.regs.ix = REC;
  m.mem8[REC + 0x0e] = 0x05; // anim hold running -> advanceObjectAnimationFrame decrements and returns
  m.mem8[REC + 0x05] = 0x00; // sub-position: no carry in the movement callee
  m.mem8[REC + 0x09] = 0x00;
  m.mem8[REC + 0x0a] = 0x00;
  m.mem8[TURN_COLUMN_LIMIT] = 0x1f; // above the seated column -> movement callee returns early
}

function craftTurnClear() {
  const m = BASE.clone();
  seatRecord(m);
  m.mem8[REC + 0x08] = 0x00; // bit0 clear -> advanceActorColumnAndArmTurnOrBand branch
  m.mem8[REC + 0x06] = 0x14; // phase 0x14 (>= 0x14) -> arm via clearColumnLimitAndArmTurnAnimation
  return m;
}

function craftTurnLatch() {
  const m = BASE.clone();
  seatRecord(m);
  m.mem8[REC + 0x08] = 0x01; // bit0 set -> advanceObjectColumnByStepAndDispatch branch
  m.mem8[REC + 0x06] = 0x08; // phase 8 (< 0x0a); advanceObjectColumnByStepAndDispatch returns (column != limit, sub-state != 4)
  m.mem8[STAGE_COUNTDOWN] = 0x05; // >= 2 -> take the latchColumnLimitAndArmTurnAnimation arm (not the signature branch)
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: turn-clear + turn-latch arms — moveFormationAndSpawnObject == oracle in RAM (−stack)", () => {
  for (const [label, craft] of [["turn-clear (clearColumnLimitAndArmTurnAnimation)", craftTurnClear], ["turn-latch (latchColumnLimitAndArmTurnAnimation)", craftTurnLatch]]) {
    const o = craft();
    oracle(o);
    const c = craft();
    moveFormationAndSpawnObject(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: turn-clear + turn-latch identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the two arms drive the turn-column limit oppositely", () => {
  const clear = craftTurnClear();
  oracle(clear);
  assert.equal(clear.mem8[TURN_COLUMN_LIMIT], 0x00, "turn-clear -> limit cleared to 0");

  const latch = craftTurnLatch();
  oracle(latch);
  assert.equal(latch.mem8[TURN_COLUMN_LIMIT], 0xff, "turn-latch -> limit latched to 0xff");

  assert.notEqual(clear.mem8[TURN_COLUMN_LIMIT], latch.mem8[TURN_COLUMN_LIMIT], "the arms must diverge");
  console.log("  WRITE-SET: turn-clear -> 0x00, turn-latch -> 0xff");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong turn-column limit is CAUGHT by the RAM diff", () => {
  const o = craftTurnClear();
  const c = craftTurnClear();
  oracle(o);
  moveFormationAndSpawnObject(c);
  c.mem8[TURN_COLUMN_LIMIT] = 0x1f; // BUG: clearColumnLimitAndArmTurnAnimation must have cleared it to 0
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong turn-column limit — it is worthless");
  assert.equal(d.addr, TURN_COLUMN_LIMIT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong turn-column limit caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH --------------------------------------------------------------
//
// moveFormationAndSpawnObject is a wired override reached through the seam; blockC9 direct-calls the dissolved initDescendingObjectSlot
// boolean, so the sweep leaves SP at the seat (moved 0). The tooth drives the SKIP path (slot 0 idle,
// initDescendingObjectSlot initializes it and returns false to abort the sweep) and asserts the routine stays
// seam-placeable. The null-mutant proof lives once-per-game in sp-seam-tooth.test.js.

/** bit0 clear, mid phase, sweep-trigger armed -> blockC9 with slot 0 idle (initDescendingObjectSlot inits + returns false). */
function craftBlockC9Skip() {
  const m = BASE.clone();
  seatRecord(m);
  m.mem.write16(SP0, CALLER_RET); // the caller-return word the seam completes (moved 0)
  m.mem8[REC + 0x08] = 0x00; // bit0 clear -> advanceActorColumnAndArmTurnOrBand branch
  m.mem8[REC + 0x06] = 0x08; // phase 8: in [5, 0x14) -> blockP
  m.mem8[SPAWN_SWEEP_TRIGGER] = 0x01; // (0x8d5b) != 0 -> straight into blockC9 (before any scan)
  m.mem8[SPAWN_OBJECT_TABLE + 0x00] = 0x00; // slot 0 idle (bit0 clear) -> 0x42da takes the init/skip path
  m.mem8[SPAWN_OBJECT_TABLE + 0x01] = 0x00;
  return m;
}

test("SP-TOOTH: moveFormationAndSpawnObject is seam-placeable on the blockC9 skip path (moved 0)", () => {
  const r = seamPlaceable(withOmittedRet, moveFormationAndSpawnObject, 0x4221, craftBlockC9Skip());
  assert.equal(r.placeable, true, `moveFormationAndSpawnObject skip path must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: moveFormationAndSpawnObject skip path seam-placeable (moved 0)");
});

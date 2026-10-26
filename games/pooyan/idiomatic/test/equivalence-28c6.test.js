// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceLeadActorSecondaryState (ROM 0x28c6, Pooyan) — the per-frame driver for the lead
 * actor's secondary state machine: frontier sub-dispatch, then steer the play sub-state, and on a
 * delay expiry dispatch the actor's state through the shared spine into the secondary-state table.
 *
 * The module dispatches the actor's state through an idiomatic switch to the eight secondary-state
 * handlers; the shared epilogue (runSpawnTickAndHunterSweep) is a downstream continuation reached via checksumIntegrityStripAndDispatchSpawn, not run
 * here — matching the oracle, whose pushed epilogue slot the frozen spine pops without executing it.
 * advanceLeadActorSecondaryState is a void driver — no register survives — so the register file is not compared;
 * equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in dead stack.
 *
 * Cases are CRAFTED (a plain boot does not seat these states): the even round forces the play
 * sub-state to 6; a busy formation forces it to 4; a running frame delay returns early; an expired
 * delay dispatches the state-2 handler.
 *
 * Jobs:
 *   1. EQUAL — all four arms: oracle == advanceLeadActorSecondaryState in RAM (−stack).
 *   2. WRITE-SET — the even round writes 6, the busy formation writes 4, at the play sub-state byte.
 *   3. TEETH — a wrong play-sub-state byte is CAUGHT by the RAM diff.
 *   4. SP-TOOTH — the switch dispatch and the delay-running arm are both SP-neutral (moved 0) through the seam.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-28c6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_28c6 as oracle } from "../../translated/loc_28c6.js";
import { advanceLeadActorSecondaryState } from "../advanceLeadActorSecondaryState.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ROUND = 0x8907; //       round counter; bit0 clear -> force sub-state 6
const FORMATION = 0x8f08; //   formation state; nonzero -> force sub-state 4
const PLAY_STATE = 0x880a; //  play sub-state index
const DELAY = 0x8a91; //       lead-record frame delay (ACTOR_TABLE + 0x11)
const LEAD_STATE = 0x8a82; //  lead-record state byte (ACTOR_TABLE + 0x02); low 3 bits = dispatch index
const SP0 = 0x8ff0; //         inside STACK_SCRATCH
const CALLER_RET = 0xfffc; //  caller-return word the dispatch/seam consumes

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const base = () => {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  return m;
};

function craftPhase6() {
  const m = base();
  m.mem8[ROUND] = 0x02; // even round -> force sub-state 6
  return m;
}
function craftPhase4() {
  const m = base();
  m.mem8[ROUND] = 0x01; //     odd round -> past the phase-6 gate
  m.mem8[FORMATION] = 0x01; // busy formation -> force sub-state 4
  return m;
}
function craftDelay() {
  const m = base();
  m.mem8[ROUND] = 0x01;
  m.mem8[FORMATION] = 0x00;
  m.mem8[DELAY] = 0x05; // running -> decrements, then transfers to the epilogue downstream
  return m;
}
function craftDispatch() {
  const m = base();
  m.mem8[ROUND] = 0x01;
  m.mem8[FORMATION] = 0x00;
  m.mem8[DELAY] = 0x01; //     expires this frame -> dispatch
  m.mem8[LEAD_STATE] = 0x02; // dispatch index 2 -> the state-2 handler
  return m;
}

const CASES = {
  "force phase 6": craftPhase6,
  "force phase 4": craftPhase4,
  "delay running -> epilogue": craftDelay,
  dispatch: craftDispatch,
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceLeadActorSecondaryState == oracle in RAM (−stack)", () => {
  for (const [label, craft] of Object.entries(CASES)) {
    const a = craft();
    const b = craft();
    oracle(a);
    advanceLeadActorSecondaryState(b);
    const d = ramDiffMinusStack(a, b);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} arms identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the round/formation gates steer the play sub-state", () => {
  const p6 = craftPhase6();
  oracle(p6);
  assert.equal(p6.mem8[PLAY_STATE], 0x06, "even round -> play sub-state 6");

  const p4 = craftPhase4();
  oracle(p4);
  assert.equal(p4.mem8[PLAY_STATE], 0x04, "busy formation -> play sub-state 4");

  assert.notEqual(p6.mem8[PLAY_STATE], p4.mem8[PLAY_STATE], "the two gates must write distinct sub-states");
  console.log("  WRITE-SET: even round -> 6; busy formation -> 4");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong play-sub-state byte is CAUGHT by the RAM diff", () => {
  const a = craftPhase6();
  const b = craftPhase6();
  oracle(a);
  advanceLeadActorSecondaryState(b);
  b.mem8[PLAY_STATE] = 0x00; // BUG: the even-round gate must have written 6
  const d = ramDiffMinusStack(a, b);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong play-sub-state byte — worthless");
  assert.equal(d.addr, PLAY_STATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong play-sub-state byte caught at ${hx(d.addr)}`);
});

// -- 4. SP-TOOTH (reviewer-rules R36) -----------------------------------------

test("SP-TOOTH: the switch dispatch is seam-placeable — moved 0, no false positive", () => {
  const r = seamPlaceable(withOmittedRet, advanceLeadActorSecondaryState, 0x28c6, craftDispatch());
  assert.equal(r.placeable, true, `the dispatch must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: dispatch seatable (moved 0, switch; epilogue deferred to checksumIntegrityStripAndDispatchSpawn)");
});

test("SP-TOOTH: the delay-running arm is seam-placeable (plain return, SP moved 0)", () => {
  const r = seamPlaceable(withOmittedRet, advanceLeadActorSecondaryState, 0x28c6, craftDelay());
  assert.equal(r.placeable, true, `the delay-running arm must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: delay-running arm seatable (moved 0, seam supplies the ret)");
});

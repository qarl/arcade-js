// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchAttractSubstate (ROM 0x0899, Pooyan) — the attract/demo sequence driver
 * (top-level game state 1): read the attract sub-state and run the matching handler from the nine-entry
 * table, then run the shared epilogue, which returns to this driver's caller.
 *
 * The module runs the handlers through an idiomatic switch and calls the epilogue directly; the oracle
 * drives the frozen rst-0x28 dispatcher, handler, and epilogue. dispatchAttractSubstate is a void driver
 * — no register survives — so equivalence is RAM (dumpState) minus stack scratch below the entry SP.
 *
 * The crafted state seats sub-state 3 (tickAttractDelayThenReseedAndAdvance, a pure countdown gate) with its frame timer still
 * running, so the handler just decrements it and returns; the epilogue is held on its clean `ret z`
 * (game-active set -> scan skipped, not free play, no credit). This isolates the driver's job —
 * READ the selector + DISPATCH + run the epilogue — with a single observable footprint (the timer).
 *
 * Jobs:
 *   1. EQUAL — oracle == dispatchAttractSubstate in RAM (−stack) for the running-timer and expiring-timer crafts.
 *   2. WRITE-SET — the dispatch reaches tickAttractDelayThenReseedAndAdvance: the frame timer is decremented.
 *   3. TEETH — a wrong timer byte is CAUGHT by the RAM diff.
 *   4. SP-TOOTH (R36) — the switch-form dispatcher is SP-neutral through the seam (no stack ops; the
 *      seam supplies the ret). Null-mutant coverage for the seam is in sp-seam-tooth.test.js.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0899.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0899 as oracle } from "../../translated/loc_0899.js";
import { dispatchAttractSubstate } from "../dispatchAttractSubstate.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ATTRACT_SUBSTATE,
  SCRIPT_FRAME_TIMER,
  GAME_ACTIVE_FLAG,
  COINAGE_CONFIG,
  CREDIT_COUNT,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8fe0; //        inside STACK_SCRATCH
const CALLER_RET = 0xfffc; // the epilogue's clean ret lands pc here (moved +2 -> placeable)
const SUBSTATE_3 = 0x03; //   dispatch -> tickAttractDelayThenReseedAndAdvance (pure countdown gate)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone: sub-state 3 seated, the frame timer set, the epilogue held on its clean ret. */
function craft(timer) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET); // the caller-return word the epilogue's ret consumes
  m.mem8[ATTRACT_SUBSTATE] = SUBSTATE_3;
  m.mem8[SCRIPT_FRAME_TIMER] = timer & 0xff;
  m.mem8[GAME_ACTIVE_FLAG] = 0x01; // epilogue: game active -> skip the table scan
  m.mem8[COINAGE_CONFIG] = 0x01; //  epilogue: not free play (!= 0x0f)
  m.mem8[CREDIT_COUNT] = 0x00; //    epilogue: no credit -> clean `ret z`
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: running + expiring frame timer — dispatchAttractSubstate == oracle in RAM (−stack)", () => {
  for (const [label, timer] of [["timer running", 0x05], ["timer expiring", 0x01]]) {
    const o = craft(timer);
    oracle(o);
    const c = craft(timer);
    dispatchAttractSubstate(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: running + expiring dispatch identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the dispatch reaches the sub-state-3 handler (frame timer ticks)", () => {
  const o = craft(0x05);
  oracle(o);
  assert.equal(o.mem8[SCRIPT_FRAME_TIMER], 0x04, "dispatch reached tickAttractDelayThenReseedAndAdvance -> timer decremented");
  console.log("  WRITE-SET: sub-state 3 dispatch decremented the frame timer");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong frame-timer byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x05);
  const c = craft(0x05);
  oracle(o);
  dispatchAttractSubstate(c);
  c.mem8[SCRIPT_FRAME_TIMER] = 0x05; // BUG: the dispatch must have ticked it to 0x04
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong timer byte — it is worthless");
  assert.equal(d.addr, SCRIPT_FRAME_TIMER, `teeth caught ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong timer byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH (R36) --------------------------------------------------------

test("SP-TOOTH: dispatchAttractSubstate is SP-neutral through the seam", () => {
  const r = seamPlaceable(withOmittedRet, dispatchAttractSubstate, 0x0899, craft(0x05));
  assert.equal(r.placeable, true, `dispatcher must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: dispatch + epilogue seat cleanly (moved +2, pc on the caller slot)");
});

// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runPlayStateFrame (ROM 0x159b, Pooyan) — the top-level game state-3 (play)
 * handler: tick the BCD play-timer, then dispatch the in-play sub-state through the frozen rst-0x28
 * dispatcher dispatchInPlaySubState with the continuation seated in HL, and run the post-dispatch continuation
 * resetToBoardBuildToContinuePlay.
 *
 * The module dissolves tickActivePlayerPlayTimer and the continuation resetToBoardBuildToContinuePlay to direct idiomatic calls and keeps
 * m.call for the frozen sub-state dispatcher dispatchInPlaySubState (continuation seated in HL); the oracle drives
 * all three through the routines map. runPlayStateFrame is a void handler returning into the NMI service — no
 * register survives — so the
 * register file is not compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in
 * dead stack so the nested dispatch pushes drop out of the diff.
 *
 * The crafted state seats the sub-state dispatch to index 1 (handler selectRoundDisplayListAndAdvancePhase) with the phase timer
 * running, so the handler's sole effect is a single phase-timer decrement; the in-play gate is set so
 * the play-timer tick runs and the continuation resetToBoardBuildToContinuePlay returns immediately — an isolated footprint.
 *
 * Jobs:
 *   1. EQUAL — oracle == runPlayStateFrame in RAM (−stack).
 *   2. WRITE-SET — the dispatch decrements the phase timer.
 *   3. TEETH — a wrong phase-timer byte is CAUGHT by the RAM diff.
 *   4. SP-TOOTH — the tail dispatch (resetToBoardBuildToContinuePlay pops the caller's slot, SP +2) is seam-placeable.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-159b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_159b as oracle } from "../../translated/loc_159b.js";
import { runPlayStateFrame } from "../runPlayStateFrame.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const STATE_INDEX = 0x880a; // PLAY_STATE_INDEX; &0x1f indexes the 0x15a8 dispatch table
const PHASE_TIMER = 0x8808; // decremented by the index-1 handler selectRoundDisplayListAndAdvancePhase
const GAME_ACTIVE = 0x8806; // GAME_ACTIVE_FLAG; set -> play-timer runs, resetToBoardBuildToContinuePlay returns at once
const SP0 = 0x8ff0; //        inside STACK_SCRATCH
const CALLER_RET = 0xfffc; // caller-return word seated at SP0; the tail dispatch pops it (pc==this)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone seated on the index-1 dispatch with the phase timer running. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[STATE_INDEX] = 0x01; // dispatch index 1 -> selectRoundDisplayListAndAdvancePhase (phase-timer decrement)
  m.mem8[PHASE_TIMER] = 0x60; // running -> handler decrements and returns
  m.mem8[GAME_ACTIVE] = 0x01; // in-play gate open
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: runPlayStateFrame == oracle in RAM (−stack)", () => {
  const o = craft();
  oracle(o);
  const c = craft();
  runPlayStateFrame(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the sub-state dispatch decrements the phase timer", () => {
  const m = craft();
  oracle(m);
  assert.equal(m.mem8[PHASE_TIMER], 0x5f, "index-1 handler decremented the phase timer");
  console.log("  WRITE-SET: phase timer 0x60 -> 0x5f");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong phase-timer byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  runPlayStateFrame(c);
  c.mem8[PHASE_TIMER] = 0x60; // BUG: the dispatch must have decremented the phase timer
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong phase-timer byte — it is worthless");
  assert.equal(d.addr, PHASE_TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong phase-timer caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: the register-bridge dispatch through dispatchInPlaySubState is seam-placeable", () => {
  const entry = craft();
  entry.mem.write16(SP0, CALLER_RET); // the caller's return word the seam completes
  const r = seamPlaceable(withOmittedRet, runPlayStateFrame, 0x159b, entry);
  assert.equal(r.placeable, true, `the dispatch must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: runPlayStateFrame dispatch seam-placeable");
});

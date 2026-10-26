// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchLevelIntroPhase (ROM 0x6da6, Pooyan) — the level-intro / round-start phase
 * dispatcher (top-level game state 2): read the intro phase counter (0x8f51) and run the matching
 * handler from the seven-entry table (a pure tail dispatch, no epilogue slot); the selected handler
 * returns straight to this dispatcher's caller.
 *
 * The module runs the dispatch through an idiomatic switch; the oracle drives the same frozen
 * rst-0x28 trampoline + handler. dispatchLevelIntroPhase is a void dispatcher — no register survives — so
 * equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in dead stack.
 *
 * The craft seats phase 3 -> handler loc_6f5e with the delay timer (0x8f48) mid-count and off world
 * 3, so the handler just decrements that timer and returns — a single observable footprint that
 * isolates the dispatcher's job (READ the selector + DISPATCH the right handler).
 *
 * Jobs:
 *   1. EQUAL — oracle == dispatchLevelIntroPhase in RAM (−stack) for the phase-3 dispatch.
 *   2. WRITE-SET — the dispatch reaches loc_6f5e: the delay timer is decremented.
 *   3. TEETH — a wrong timer byte is CAUGHT by the RAM diff.
 *   4. SP-TOOTH (R36) — the push16 + rst-28 tail dispatch is seam-placeable (a dropped push16 goes
 *      RED in the shared sp-seam-tooth.test.js null-mutant).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6da6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6da6 as oracle } from "../../translated/loc_6da6.js";
import { dispatchLevelIntroPhase } from "../dispatchLevelIntroPhase.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, INTRO_PHASE_INDEX } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PHASE_3 = 0x03; //       dispatch -> loc_6f5e (phase-3 timing gate)
const INTRO_DELAY = 0x8f48; // the delay timer loc_6f5e ticks
const ROUND_COUNTER = 0x8907; // world select; != 3 keeps loc_6f5e off the anti-tamper compare
const SP0 = 0x8fe0; //         inside STACK_SCRATCH
const CALLER_RET = 0xfffc; //  the handler's ret lands pc here (moved +2 -> placeable)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone: phase 3 seated, delay timer mid-count, off world 3, a caller-return word at SP0. */
function craft(delay) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET); // the caller-return word the handler's ret consumes
  m.mem8[INTRO_PHASE_INDEX] = PHASE_3;
  m.mem8[INTRO_DELAY] = delay & 0xff; // != 0x20 -> loc_6f5e just decrements it and returns
  m.mem8[ROUND_COUNTER] = 0x01; // not world 3 -> no anti-tamper compare even at expiry
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: phase-3 dispatch — dispatchLevelIntroPhase == oracle in RAM (−stack)", () => {
  const o = craft(0x05);
  oracle(o);
  const c = craft(0x05);
  dispatchLevelIntroPhase(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: phase-3 dispatch identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the dispatch reaches loc_6f5e (delay timer ticks)", () => {
  const o = craft(0x05);
  oracle(o);
  assert.equal(o.mem8[INTRO_DELAY], 0x04, "dispatch reached loc_6f5e -> delay timer decremented");
  console.log("  WRITE-SET: phase-3 dispatch decremented the delay timer");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong delay-timer byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x05);
  const c = craft(0x05);
  oracle(o);
  dispatchLevelIntroPhase(c);
  c.mem8[INTRO_DELAY] = 0x05; // BUG: the dispatch must have ticked it to 0x04
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong timer byte — it is worthless");
  assert.equal(d.addr, INTRO_DELAY, `teeth caught ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong timer byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH (R36) --------------------------------------------------------

test("SP-TOOTH: dispatchLevelIntroPhase's push16 + rst-28 tail dispatch is seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, dispatchLevelIntroPhase, 0x6da6, craft(0x05));
  assert.equal(r.placeable, true, `dispatcher must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: tail dispatch seats cleanly (moved +2, pc on the caller slot)");
});

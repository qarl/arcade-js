// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchFormationPhaseOrQueueLaunchSlots (ROM 0x308b, Pooyan) — the formation manager.
 *
 * The module dispatches the formation phase through an idiomatic switch to the three phase handlers
 * and direct-calls the idiomatic epilogue (advanceWaveTeardownByState); the oracle drives the same handlers and
 * epilogue through the frozen rst-28 spine that new Machine(ROM) builds. dispatchFormationPhaseOrQueueLaunchSlots is a void manager — no register survives —
 * so the register file is not compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP
 * parked in dead stack so nested pushes drop out.
 *
 * Cases are CRAFTED: a plain boot does not seat these formation states. The dispatch case selects
 * the state-2 handler (a ROM self-check that returns without writing on a valid ROM) and holds the
 * epilogue on its no-op arm (teardown state 0), so the dispatch's own footprint is isolated.
 *
 * Jobs:
 *   1. EQUAL — disabled, scan/no-candidate, scan/single-launch, scan/fill (arms), and dispatch:
 *      oracle == module in RAM (−stack).
 *   2. WRITE-SET — disabled is inert; a full scan arms the formation; an exhausted scan resets the
 *      slot-table head.
 *   3. TEETH — a wrong slot byte is caught by the RAM diff; and a no-op twin (which never arms the
 *      formation) diverges from the oracle on the fill case.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-308b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_308b as oracle } from "../../translated/loc_308b.js";
import { dispatchFormationPhaseOrQueueLaunchSlots } from "../dispatchFormationPhaseOrQueueLaunchSlots.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ENABLE = 0x8f04; //  formation enable gate
const STATE = 0x8f08; //   formation state (0 -> scan; nonzero -> dispatch)
const ARM09 = 0x8f09; //   second arm byte, set to 0x20 when the table fills
const TEARDOWN = 0x8f24; // epilogue teardown state (0 -> epilogue no-op)
const SLOT = 0x8920; //    formation slot table (stride 2)
const EAT = 0x8ae0; //     actor records (stride 0x18)
const STRIDE = 0x18;
const COUNT = 0x11;
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const base = () => {
  const m = BASE.clone();
  m.regs.sp = SP0;
  return m;
};
/** Mark records [from, COUNT) non-candidate (state byte != 0 and != 5). */
function nonCandidateFrom(m, from) {
  for (let i = from; i < COUNT; i++) m.mem8[EAT + i * STRIDE + 0] = 0xff;
  return m;
}

function craftDisabled() {
  const m = base();
  m.mem8[ENABLE] = 0x00;
  return m;
}
function craftNoCandidate() {
  const m = base();
  m.mem8[ENABLE] = 0x01;
  m.mem8[STATE] = 0x00;
  m.mem8[SLOT] = 0x99; // seed nonzero so the reset-to-0 is observable
  return nonCandidateFrom(m, 0);
}
function craftSingle() {
  const m = base();
  m.mem8[ENABLE] = 0x01;
  m.mem8[STATE] = 0x00;
  m.mem8[SLOT] = 0x99;
  return nonCandidateFrom(m, 1); // record 0 stays candidate (state 0, ready 0)
}
function craftFill() {
  const m = base();
  m.mem8[ENABLE] = 0x01;
  m.mem8[STATE] = 0x00;
  return nonCandidateFrom(m, 4); // records 0..3 candidate -> fills at the fourth
}
function craftDispatch() {
  const m = base();
  m.mem8[ENABLE] = 0x01;
  m.mem8[STATE] = 0x03; // (3 & 3) - 1 = 2 -> state-2 handler (ROM self-check)
  m.mem8[TEARDOWN] = 0x00; // epilogue no-op
  return m;
}

const CASES = {
  disabled: craftDisabled,
  "scan/no-candidate": craftNoCandidate,
  "scan/single-launch": craftSingle,
  "scan/fill": craftFill,
  dispatch: craftDispatch,
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: dispatchFormationPhaseOrQueueLaunchSlots == oracle in RAM (−stack)", () => {
  for (const [label, craft] of Object.entries(CASES)) {
    const a = craft();
    const b = craft();
    oracle(a);
    dispatchFormationPhaseOrQueueLaunchSlots(b);
    const d = ramDiffMinusStack(a, b);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: disabled inert; fill arms; no-candidate resets the slot head", () => {
  const dis = craftDisabled();
  const before = dis.dumpState();
  oracle(dis);
  assert.deepEqual([...dis.dumpState()], [...before], "disabled must leave RAM untouched");

  const fill = craftFill();
  oracle(fill);
  assert.equal(fill.mem8[STATE], 0x01, "a full scan arms the formation state");
  assert.equal(fill.mem8[ARM09], 0x20, "a full scan writes the arm byte");

  const none = craftNoCandidate();
  oracle(none);
  assert.equal(none.mem8[SLOT], 0x00, "an exhausted scan resets the slot-table head");
  console.log("  WRITE-SET: disabled inert; fill arms; exhausted scan resets");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong slot byte is CAUGHT by the RAM diff", () => {
  const a = craftFill();
  const b = craftFill();
  oracle(a);
  dispatchFormationPhaseOrQueueLaunchSlots(b);
  b.mem8[SLOT + 0] = (a.mem8[SLOT + 0] ^ 0xff) & 0xff; // corrupt the first stored pointer
  const d = ramDiffMinusStack(a, b);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted slot byte — worthless");
  assert.equal(d.addr, SLOT + 0, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong slot byte caught at ${hx(d.addr)}`);
});

test("TEETH: a no-op twin never arms the formation — diverges from the oracle", () => {
  const a = craftFill();
  const twin = craftFill();
  oracle(a);
  // a broken manager that returns without scanning leaves the formation un-armed
  const d = ramDiffMinusStack(a, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a manager that never armed the formation");
  console.log(`  TEETH/twin: un-armed twin caught at ${hx(d.addr ?? 0)}`);
});

// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceLeadActorPrimaryState (ROM 0x241e, Pooyan) — the per-frame lead-actor-group
 * driver: run three sub-passes in order, abort on the freeze flag, else dispatch the lead record's
 * state through an idiomatic switch to its six state handlers (the oracle drives the frozen spine).
 *
 * The module dispatches the lead record's state through an idiomatic switch to the six handlers; the
 * oracle drives the same frozen sub-passes and rst-28 spine into the same handlers. advanceLeadActorPrimaryState is a
 * void driver — no register survives — so the register file is not compared; equivalence is RAM
 * (dumpState) minus stack scratch below the entry SP, SP parked in dead stack so nested pushes drop out.
 *
 * The crafted states hold the sub-passes on benign arms (hunter pass gated off, rope pass on its
 * plain timer decrement) so the driver's own job — ORDER + freeze abort + dispatch — is isolated.
 * The dispatch index is seated to the state-1 handler, whose sole effect on a running frame-delay
 * is to decrement the lead record's delay byte — an observable, isolated footprint.
 *
 * Jobs:
 *   1. EQUAL — dispatch state (freeze clear) and abort state (freeze set): oracle == advanceLeadActorPrimaryState in
 *      RAM (−stack).
 *   2. WRITE-SET — the freeze flag gates the dispatch: clear runs the handler (delay byte ticks),
 *      set skips it (delay byte held), so the two states differ at the delay byte.
 *   3. TEETH — a wrong delay byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-241e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_241e as oracle } from "../../translated/loc_241e.js";
import { advanceLeadActorPrimaryState } from "../advanceLeadActorPrimaryState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FREEZE = 0x881e; //  tamper-freeze flag: nonzero aborts before the dispatch
const STATE = 0x8a82; //  lead record state byte (ACTOR_TABLE + 2); low 3 bits = dispatch index
const DELAY = 0x8a91; //  lead record frame-delay byte (+0x11); the state-1 handler ticks it
const REC7 = 0x8a87; //  lead record +7; held bit4-clear to keep sub-pass one minimal
const HUNTER_GATE = 0x8f04; //  hunter pass abort gate (0 -> no-op)
const ROPE_GATE = 0x8907; //  rope pass gate (bit0 set -> plain timer path)
const ROPE_TIMER = 0x8f09; //  rope pass 0x10-frame timer (running -> dec + ret)
const LAUNCH_STATE = 0x8f30; //  launch state machine (0 -> its state-0 handler)
const SP0 = 0x8ff0; //  inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the sub-passes on benign arms and the state-1 handler dispatch seated. */
function craft(freeze) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[FREEZE] = freeze & 0xff;
  m.mem8[STATE] = 0x01; // dispatch index 1 -> the frame-delay handler
  m.mem8[DELAY] = 0x05; // frame delay running -> handler decrements and returns
  m.mem8[REC7] = 0x00; // sub-pass one: bit4 clear -> minimal
  m.mem8[HUNTER_GATE] = 0x00; // hunter pass gated off
  m.mem8[ROPE_GATE] = 0x01; // rope pass: bit0 set -> timer path
  m.mem8[ROPE_TIMER] = 0x05; // rope timer running -> dec + ret
  m.mem8[LAUNCH_STATE] = 0x00; // launch state 0
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: dispatch + abort states — advanceLeadActorPrimaryState == oracle in RAM (−stack)", () => {
  for (const [label, freeze] of [["dispatch (freeze clear)", 0x00], ["abort (freeze set)", 0x01]]) {
    const o = craft(freeze);
    oracle(o);
    const c = craft(freeze);
    advanceLeadActorPrimaryState(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: dispatch + abort identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the freeze flag gates the state dispatch", () => {
  const disp = craft(0x00);
  oracle(disp);
  assert.equal(disp.mem8[DELAY], 0x04, "freeze clear -> handler decremented the delay byte");

  const abort = craft(0x01);
  oracle(abort);
  assert.equal(abort.mem8[DELAY], 0x05, "freeze set -> dispatch skipped, delay byte held");

  assert.notEqual(disp.mem8[DELAY], abort.mem8[DELAY], "the freeze flag must gate the dispatch");
  console.log("  WRITE-SET: freeze clear ticks the delay, freeze set holds it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong delay byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x00);
  const c = craft(0x00);
  oracle(o);
  advanceLeadActorPrimaryState(c);
  c.mem8[DELAY] = 0x05; // BUG: the dispatch must have ticked the delay to 0x04
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong delay byte — it is worthless");
  assert.equal(d.addr, DELAY, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong delay byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

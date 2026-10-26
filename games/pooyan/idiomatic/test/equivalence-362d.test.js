// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchActorPhaseGatedByDelay (ROM 0x362d, Pooyan) — phase dispatch for the actor record
 * at IX, gated by a per-actor delay. The phase byte (rec+0x06) routes the low range to the
 * end-of-move guard (dispatchEndOfMoveIfFlagged) and the high range to the target resolver (resolveActorTargetUnlessCommitted). In the middle
 * band a global progress gate lets one phase return early; otherwise a per-actor delay counts down
 * (returning while it runs), and when it elapses for a near-half actor the delay is reloaded from a
 * round-selected table and control falls into the pre-spawn gate (spawnObjectGatedByArmedActorCount).
 *
 * SEATING: the three tail branches (dispatchEndOfMoveIfFlagged / resolveActorTargetUnlessCommitted / spawnObjectGatedByArmedActorCount) are TAIL-CALLs — the module
 * forwards each delegate's result; the early exits are plain BALANCED rets (LIVE-OUT none). Compared
 * on RAM (dumpState) minus stack scratch below the entry SP; the register file is not compared. SP is parked in
 * STACK_SCRATCH so the oracle's nested calls drop out.
 *
 * The module calls the idiomatic siblings directly; the oracle drives the translated siblings via
 * the routines map. The guard/resolver branches are seated so their delegate returns inertly, and
 * the reload branch is seated so spawnObjectGatedByArmedActorCount's count scan finds no match and returns without writing —
 * isolating dispatchActorPhaseGatedByDelay's own effect (the delay counter) from the delegates. Cases are CRAFTED.
 *
 * Jobs:
 *   1. EQUAL — the phase<7 guard, the phase>=0x14 resolver, the progress-gate early return, the
 *      delay countdown, the far-actor return, and the reload-into-pre-spawn branch: oracle == module.
 *   2. WRITE-SET — a running delay is decremented; an early-return branch leaves it untouched.
 *   3. TEETH — a corrupted delay byte and a no-op twin (never decrements) are caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-362d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_362d as oracle } from "../../translated/loc_362d.js";
import { dispatchActorPhaseGatedByDelay } from "../dispatchActorPhaseGatedByDelay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const DELAY = 0x8d6b; // ACTOR_DELAY_COUNTER
const TIMER = 0x8d7d; // WAVE_PROGRESS_COUNTER
const ROUND = 0x8907; // ROUND_COUNTER
const SCAN = 0x8ae2; // spawnObjectGatedByArmedActorCount count-scan record base (stride 0x18, 6 records)
const IX = 0x8c50; // actor record (clear of the scan region and the pre-spawn window)
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record + gates. Defaults land in the middle band with the delay running. */
function seat(m, { phase = 0x10, timer = 0x00, delay = 0x05, xPos = 0x10, latch = 0x00 } = {}) {
  m.regs.ix = IX;
  m.regs.b = xPos;
  m.regs.sp = SP0;
  m.mem.write8(IX + 0x06, phase);
  m.mem.write8(IX + 0x08, latch); // dispatchEndOfMoveIfFlagged/resolveActorTargetUnlessCommitted guard bit
  m.mem.write8(IX + 0x0b, 0x01); // spawnObjectGatedByArmedActorCount takes the count-scan path...
  m.mem.write8(TIMER, timer);
  m.mem.write8(DELAY, delay);
  m.mem.write8(ROUND, 0x00);
  for (let i = 0; i < 6; i++) m.mem.write8(SCAN + i * 0x18, 0x00); // ...which finds no match -> inert
  return m;
}

const craftLow = () => seat(BASE.clone(), { phase: 0x03, latch: 0x00 }); // -> dispatchEndOfMoveIfFlagged guard (inert)
const craftHigh = () => seat(BASE.clone(), { phase: 0x20, latch: 0x01 }); // -> resolveActorTargetUnlessCommitted guard (inert)
const craftGateRet = () => seat(BASE.clone(), { phase: 0x10, timer: 0x0e }); // progress gate -> early ret
const craftDelayRun = () => seat(BASE.clone(), { delay: 0x05 }); // countdown -> dec + ret
const craftFarRet = () => seat(BASE.clone(), { delay: 0x00, xPos: 0x90 }); // far actor -> ret
const craftReload = () => seat(BASE.clone(), { delay: 0x00, xPos: 0x10 }); // reload -> spawnObjectGatedByArmedActorCount (inert)

const CASES = [
  ["phase<7 guard", craftLow],
  ["phase>=0x14 resolver", craftHigh],
  ["progress-gate early return", craftGateRet],
  ["delay countdown", craftDelayRun],
  ["far-actor return", craftFarRet],
  ["reload into pre-spawn", craftReload],
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: every branch — module == oracle in RAM (−stack)", () => {
  for (const [label, craft] of CASES) {
    const o = craft();
    const c = craft();
    oracle(o);
    dispatchActorPhaseGatedByDelay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches RAM identical`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a running delay decrements; an early return leaves it untouched", () => {
  const run = craftDelayRun();
  dispatchActorPhaseGatedByDelay(run);
  assert.equal(run.mem.read8(DELAY), 0x04, "running delay decremented");

  const gate = craftGateRet();
  dispatchActorPhaseGatedByDelay(gate);
  assert.equal(gate.mem.read8(DELAY), 0x05, "progress-gate return leaves the delay untouched");
  console.log("  WRITE-SET: delay decremented on countdown; untouched on early return");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted delay byte is CAUGHT by the RAM diff", () => {
  const o = craftDelayRun();
  const c = craftDelayRun();
  oracle(o);
  dispatchActorPhaseGatedByDelay(c);
  c.mem.write8(DELAY, (o.mem.read8(DELAY) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted delay byte");
  assert.equal(d.addr, DELAY, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(DELAY)})`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a no-op twin that never decrements the delay diverges from the oracle", () => {
  const o = craftDelayRun();
  const twin = craftDelayRun(); // a broken handler that does nothing
  oracle(o);
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a handler that never acts");
  assert.equal(d.addr, DELAY, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(DELAY)})`);
  console.log(`  TEETH(no-op): caught at ${hx(d.addr)}`);
});

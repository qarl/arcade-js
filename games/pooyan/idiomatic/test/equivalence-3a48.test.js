// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resetActorSubstateAndReloadStateTimer (ROM 0x3a48, Pooyan) — reset the enemy actor's sub-state and
 * reload its state timer on the IX record.
 *
 * SEATING: BALANCED (plain ret). LIVE-OUT is memory only — the routine writes rec+2 = 0 and
 * rec+0x11 = 0x20 and returns; nothing reads a register back — so the comparison is RAM (dumpState)
 * minus stack scratch below the entry SP. The record is pre-dirtied so both writes are observable.
 *
 * Jobs:
 *   1. EQUAL — oracle == module in RAM (−stack).
 *   2. WRITE-SET — exactly rec+2 and rec+0x11 change, to the specified values.
 *   3. TEETH — a corrupted timer byte is caught; a twin that skips the sub-state clear diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3a48.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3a48 as oracle } from "../../translated/loc_39af.js";
import { resetActorSubstateAndReloadStateTimer } from "../resetActorSubstateAndReloadStateTimer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b80; // isolated actor record base (rec..rec+0x17)
const REC_SUBSTATE = 0x02;
const REC_TIMER = 0x11;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** IX=REC, the record pre-dirtied to 0x55 so both writes are observable. */
function craft() {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8ff0;
  for (let i = 0; i < 0x18; i++) m.mem8[REC + i] = 0x55;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: resetActorSubstateAndReloadStateTimer == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  resetActorSubstateAndReloadStateTimer(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: exactly rec+2 and rec+0x11 change", () => {
  const before = craft().dumpState();
  const after = craft();
  oracle(after);
  const a1 = after.dumpState();
  const changed = [];
  for (let off = 0; off < before.length; off++) if (before[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  assert.deepEqual(changed.sort((a, b) => a - b), [REC + REC_SUBSTATE, REC + REC_TIMER],
    `expected only rec+2 and rec+0x11 to change, got ${changed.map(hx)}`);
  assert.equal(after.mem8[REC + REC_SUBSTATE], 0x00, "sub-state cleared to 0");
  assert.equal(after.mem8[REC + REC_TIMER], 0x20, "timer reloaded to 0x20");
  console.log("  WRITE-SET: rec+2 = 0, rec+0x11 = 0x20");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted timer byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  resetActorSubstateAndReloadStateTimer(c);
  c.mem8[REC + REC_TIMER] = (c.mem8[REC + REC_TIMER] ^ 0xff) & 0xff; // BUG: wrong reload
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted timer byte");
  assert.equal(d.addr, REC + REC_TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the sub-state clear diverges from the oracle", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  resetActorSubstateAndReloadStateTimer(c);
  c.mem8[REC + REC_SUBSTATE] = 0x55; // BUG twin: as if the clear never ran
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped sub-state clear must be caught");
  assert.equal(d.addr, REC + REC_SUBSTATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(skip): caught at ${hx(d.addr)}`);
});

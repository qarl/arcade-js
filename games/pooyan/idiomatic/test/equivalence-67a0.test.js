// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for ascendEnemyActorAndLinkedSlotOnTimer (ROM 0x67a0) — "per-object frame update": while the shared
 * frame-delay timer (SHARED_FRAME_DELAY_TIMER) is non-zero, decrement it and return; on expiry step
 * the object's animation (advanceObjectAnimationFrame), move the linked record's +0x05/+0x06 pair (if +0x07/+0x08 has a
 * non-zero high byte) and the object's own +0x05/+0x06 pair down by the +0x09 speed (a 16-bit
 * borrow decrements the high byte), and advance the object's state (+0x02) when its own +0x06 high
 * byte reaches zero.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES work RAM, so every case uses
 * a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * The contract is MEMORY ONLY: a per-frame state handler reached only through anti-tamper / object-
 * dispatch tails (reinitRoundArenaAndPlayfieldIfImageIntact, dispatchDescendingObjectState) that do not read back its leftover registers. pc/SP/cycles are
 * not compared. advanceObjectAnimationFrame is kept deterministic by seating a non-zero +0x0e hold, so it simply
 * decrements that field (its own script-walk is its own test's concern); both sides run the same
 * advanceObjectAnimationFrame over the same memory. Inputs (the timer + record/link fields) are poked per side.
 *
 * Jobs: 1. EQUAL over timer-hold / no-link / link+borrow+state-advance; 2. WRITE-SET (exact
 * footprint of the early path and the full path); 3. TEETH (a wrong position byte + a missed tick).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-67a0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_67a0 as oracle } from "../../translated/loc_67a0.js";
import { ascendEnemyActorAndLinkedSlotOnTimer } from "../ascendEnemyActorAndLinkedSlotOnTimer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SHARED_FRAME_DELAY_TIMER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8a80; // object record base
const LINK = 0x8ae0; // linked record base
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/**
 * Seat the timer and the record fields ascendEnemyActorAndLinkedSlotOnTimer reads. `rec` fields: 0x02 state, 0x05/0x06 own
 * position pair, 0x07/0x08 link pointer, 0x09 speed, 0x0e advanceObjectAnimationFrame hold. Optional `link` fields.
 */
function craft({ timer, rec, link }) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe;
  m.regs.ix = REC;
  m.mem.write8(SHARED_FRAME_DELAY_TIMER, timer);
  for (const [off, v] of Object.entries(rec)) m.mem.write8(REC + Number(off), v);
  if (link) for (const [off, v] of Object.entries(link)) m.mem.write8(LINK + Number(off), v);
  return m;
}

// 1: timer holding (early return). 2: expired, no link, no borrow/advance. 3: expired, link present,
// both pairs borrow, own high byte hits 0 -> state advance.
const CASE_HOLD = { timer: 0x05, rec: { 0x02: 0x01, 0x05: 0x40, 0x06: 0x02, 0x07: 0x00, 0x08: 0x00, 0x09: 0x05, 0x0e: 0x03 } };
const CASE_NOLINK = { timer: 0x00, rec: { 0x02: 0x01, 0x05: 0x40, 0x06: 0x02, 0x07: 0x00, 0x08: 0x00, 0x09: 0x05, 0x0e: 0x04 } };
const CASE_LINK = {
  timer: 0x00,
  rec: { 0x02: 0x01, 0x05: 0x03, 0x06: 0x01, 0x07: 0xe0, 0x08: 0x8a, 0x09: 0x05, 0x0e: 0x02 },
  link: { 0x05: 0x02, 0x06: 0x10 },
};
const CASES = [CASE_HOLD, CASE_NOLINK, CASE_LINK];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: hold / no-link / link+borrow+advance — ascendEnemyActorAndLinkedSlotOnTimer == oracle in RAM (−stack)", () => {
  CASES.forEach((cse, i) => {
    const o = craft(cse);
    const c = craft(cse);
    oracle(o);
    ascendEnemyActorAndLinkedSlotOnTimer(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} (case ${i}): oracle=${d.a} idiom=${d.b}`);
  });
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: early path ticks only the timer; full path writes the exact field footprint", () => {
  const changedOf = (cse) => {
    const before = craft(cse);
    const after = craft(cse);
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    const out = new Map();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] === a1[off]) continue;
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) out.set(addr, a1[off]);
    }
    return out;
  };

  const hold = changedOf(CASE_HOLD);
  assert.equal(hold.size, 1, `hold path writes only the timer, got ${hold.size}`);
  assert.equal(hold.get(SHARED_FRAME_DELAY_TIMER), 0x04, "timer 0x05 -> 0x04");

  const link = changedOf(CASE_LINK);
  const want = new Map([
    [REC + 0x0e, 0x01], // advanceObjectAnimationFrame hold 0x02 -> 0x01
    [REC + 0x05, 0xfe], // 0x03 - 0x05 = borrow -> 0xfe
    [REC + 0x06, 0x00], // borrow decrements 0x01 -> 0x00
    [REC + 0x02, 0x02], // own high byte hit 0 -> state advance 0x01 -> 0x02
    [LINK + 0x05, 0xfd], // 0x02 - 0x05 = borrow -> 0xfd
    [LINK + 0x06, 0x0f], // borrow decrements 0x10 -> 0x0f
  ]);
  assert.equal(link.size, want.size, `full path expected ${want.size} writes, got ${link.size}`);
  for (const [addr, v] of want) assert.equal(link.get(addr), v, `write at ${hx(addr)} must be ${hx(v)}`);
  console.log(`  WRITE-SET: hold -> {timer}; full -> {+0e,+05,+06,+02, link+05, link+06}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong own-position byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASE_LINK);
  const c = craft(CASE_LINK);
  oracle(o);
  ascendEnemyActorAndLinkedSlotOnTimer(c);
  const bug = REC + 0x05;
  c.mem.write8(bug, 0x00); // BUG: own +0x05 must be the borrowed 0xfe

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong position byte — it is worthless");
  assert.equal(d.addr, bug, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(bug)})`);
  console.log(`  TEETH/RAM: wrong +0x05 caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a missed timer tick is CAUGHT on the early path", () => {
  const o = craft(CASE_HOLD);
  const c = craft(CASE_HOLD);
  oracle(o);
  ascendEnemyActorAndLinkedSlotOnTimer(c);
  c.mem.write8(SHARED_FRAME_DELAY_TIMER, 0x05); // BUG: timer should have decremented to 0x04

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missed timer tick — it is worthless");
  assert.equal(d.addr, SHARED_FRAME_DELAY_TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/timer: missed tick caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

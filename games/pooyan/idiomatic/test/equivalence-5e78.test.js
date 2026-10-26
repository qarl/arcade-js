// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for sweepActorRecordSlotsBothParitiesOnOddRound (ROM 0x5e78, Pooyan) — the gated actor-sweep driver. On an
 * odd round it hands the actor-record table to the per-slot sweep dispatchTargetPairCollisionSweep twice: phase latch 0 on
 * the first pass and 1 after, with the table pointer advanced one record between passes. On an even
 * round it returns without touching anything.
 *
 * SEATING: BALANCED — a plain ret both when disabled (ret z) and after the two passes. dispatchTargetPairCollisionSweep is
 * NOT lifted this batch, so the module keeps the register-marshalled m.call(0x5e98) (phase latch in
 * I, table pointer in IY); the oracle drives the same frozen dispatchTargetPairCollisionSweep, so both walk identical
 * downstream code. Compared on RAM (dumpState) minus stack scratch below the entry SP; the register file is not
 * compared (void driver).
 *
 * Cases are CRAFTED: a plain boot does not seat this pair/slot geometry. The two-hit case makes the
 * first pass (box A) strike slot 0 and the second pass (box B, one record further) strike slot 1,
 * so BOTH passes and the between-pass pointer advance are observable.
 *
 * Jobs:
 *   1. EQUAL — two-hit (gate on) and gate-off (even round): oracle == module in RAM (−stack).
 *   2. WRITE-SET — gate on strikes slot 0 and slot 1; gate off leaves RAM untouched.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a single-pass twin (runs the sweep
 *      once) leaves slot 1 unstruck, caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5e78.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5e78 as oracle } from "../../translated/loc_5e78.js";
import { sweepActorRecordSlotsBothParitiesOnOddRound } from "../sweepActorRecordSlotsBothParitiesOnOddRound.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const GATE = 0x8907; // odd-round gate (bit0)
const BIAS_FLAG = 0x881f;
const PAIR0 = 0x8c90; // I==0 actor-record pair
const PAIR1 = 0x8ca8; // I!=0 actor-record pair
const SLOT0 = 0x8c30; // swept slot struck by pass 0 (box A)
const SLOT1 = 0x8c48; // swept slot struck by pass 1 (box B)
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0 - 2); // entry SP: the seat pushes the caller's return word below SP0
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Gate on; both pairs active (bit1 clear -> the testAndCatchActorSlotOnOverlap sweep); slot 0 hits box A, slot 1 box B. */
function seatTwoHit(m) {
  m.regs.sp = SP0;
  m.push16(0xabcd);
  m.mem.write8(GATE, 0x01); // odd round -> enabled
  m.mem.write8(BIAS_FLAG, 0x01); // bias +6
  m.mem.write8(PAIR0, 0x01); // active, bit1 clear
  m.mem.write8(PAIR1, 0x01); // active, bit1 clear
  // pass 0: box A = 0x8848, actor 0x8888, slot 0 = 0x8c30
  m.mem.write8(SLOT0 + 0, 0x01);
  m.mem.write8(SLOT0 + 2, 0x02);
  m.mem.write8(0x8888, 0x30);
  m.mem.write8(0x888a, 0x40);
  m.mem.write8(0x8848, 0x30);
  m.mem.write8(0x884a, 0x38);
  m.mem.write8(0x8c97, 0x01); // (PAIR0+7) bit0 -> skip memset
  // pass 1: box B = 0x884c, actor 0x888c, slot 1 = 0x8c48
  m.mem.write8(SLOT1 + 0, 0x01);
  m.mem.write8(SLOT1 + 2, 0x02);
  m.mem.write8(0x888c, 0x30);
  m.mem.write8(0x888e, 0x40);
  m.mem.write8(0x884c, 0x30);
  m.mem.write8(0x884e, 0x38);
  m.mem.write8(0x8caf, 0x01); // (PAIR1+7) bit0 -> skip memset
  return m;
}
const craftTwoHit = () => seatTwoHit(BASE.clone());
function craftGateOff() {
  const m = seatTwoHit(BASE.clone());
  m.mem.write8(GATE, 0x00); // even round -> disabled
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: sweepActorRecordSlotsBothParitiesOnOddRound == oracle in RAM (−stack)", () => {
  for (const [label, craft] of [["two-hit (gate on)", craftTwoHit], ["gate off", craftGateOff]]) {
    const o = craft();
    const c = craft();
    oracle(o);
    sweepActorRecordSlotsBothParitiesOnOddRound(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: two-hit + gate-off identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: gate on strikes both passes' slots; gate off is inert", () => {
  const on = craftTwoHit();
  oracle(on);
  assert.equal(on.mem.read8(SLOT0), 0x00, "pass 0 strikes slot 0");
  assert.equal(on.mem.read8(SLOT1), 0x00, "pass 1 strikes slot 1 (needs the between-pass advance)");

  const off = craftGateOff();
  const b0 = off.dumpState();
  oracle(off);
  assert.deepEqual([...off.dumpState()], [...b0], "an even round must leave RAM untouched");
  console.log("  WRITE-SET: gate on strikes 2 slots; gate off inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftTwoHit();
  const c = craftTwoHit();
  oracle(o);
  sweepActorRecordSlotsBothParitiesOnOddRound(c);
  c.mem.write8(SLOT1 + 1, (o.mem.read8(SLOT1 + 1) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, SLOT1 + 1, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a single-pass twin leaves slot 1 unstruck and is CAUGHT", () => {
  function twin(m) {
    const { mem8, regs } = m;
    if ((mem8[GATE] & 0x01) === 0) return;
    regs.iy = 0x8848; // only the first pass
    regs.i = 0;
    m.call(0x5e98);
  }
  const o = craftTwoHit();
  const t = craftTwoHit();
  oracle(o);
  twin(t);
  const d = ramDiffMinusStack(o, t);
  assert.notEqual(d, null, "the gate FAILED to catch a dropped pass");
  assert.equal(t.mem.read8(SLOT1), 0x01, "single-pass twin left slot 1 unstruck");
  assert.equal(o.mem.read8(SLOT1), 0x00, "oracle struck slot 1 on the second pass");
  console.log(`  TEETH(pass): caught at ${hx(d.addr ?? 0)}`);
});

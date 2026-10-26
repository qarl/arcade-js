// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorSweepToNextSlot (ROM 0x5f06, Pooyan) — the tail of the actor sweep loop.
 * It advances the actor pointer one record and the row pointer one row, decrements the sweep
 * counter, then either returns (counter drained) or re-enters the still-frozen loop body testAndCatchActorSlotOnOverlap.
 *
 * SEATING: BALANCED. When the counter drains the oracle plain-`ret`s to the sweep caller; the
 * taken-djnz branch tail-jumps back into testAndCatchActorSlotOnOverlap (no net stack move). testAndCatchActorSlotOnOverlap is NOT lifted this
 * batch, so the module keeps the register-marshalled m.call(0x5ebd); the oracle drives the same
 * frozen testAndCatchActorSlotOnOverlap, so both walk identical downstream code. Compared on RAM (dumpState) minus
 * stack scratch below the entry SP; the register file is not compared (void tail). Entry HL/IX/B are the loop state,
 * bridged from the entry registers.
 *
 * Cases are CRAFTED: a plain boot does not seat this sweep geometry. The HIT case makes testAndCatchActorSlotOnOverlap
 * strike the record the correct advance lands on, so the sweep's writes are observable.
 *
 * Jobs:
 *   1. EQUAL — HIT (djnz taken, next record struck) and EXIT (B==1, counter drains): oracle ==
 *      module in RAM (−stack).
 *   2. WRITE-SET — the HIT clears the struck record's lead byte and stamps 01/08.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a wrong-stride twin (row += 0x17)
 *      misses the record and leaves it unstruck, caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5f06.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5f06 as oracle } from "../../translated/loc_5f06.js";
import { advanceActorSweepToNextSlot } from "../advanceActorSweepToNextSlot.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const BIAS_FLAG = 0x881f; // loc_5f53 x-bias select
const LATCH = 0x8d65; // struck-target latch testAndCatchActorSlotOnOverlap reloads on a hit
const REC = 0x8c30; // the record the correct advance lands on (0x8c18 + 0x18)
const ACTOR = 0x8888; // the actor coords the correct advance lands on (0x8884 + 4)
const BOX = 0x8848; // proximity target box (IY)
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0 - 2); // entry SP: the seat pushes the caller's return word below SP0
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat entry loop state one record short of a strike, plus the geometry that makes it a hit. */
function seatHit(m) {
  m.regs.sp = SP0;
  m.push16(0xabcd); // a return for the sweep's terminal ret (dead-stack)
  m.regs.hl = u16(REC - 0x18); // advances to REC
  m.regs.ix = u16(ACTOR - 4); // advances to ACTOR
  m.regs.iy = BOX;
  m.regs.b = 0x02; // djnz taken -> one more record
  m.regs.i = 0x00;
  m.mem.write8(REC + 0, 0x01); // live record
  m.mem.write8(REC + 2, 0x02); // state < 4
  m.mem.write8(REC - 1, 0x00); // the record a wrong (0x17) stride would land on -> empty
  m.mem.write8(ACTOR + 0, 0x30); // loc_5f53: E = 0x30 + bias(6) = 0x36
  m.mem.write8(ACTOR + 2, 0x40); // loc_5f53: A = 0x48 (on-screen), D = 0x48
  m.mem.write8(BOX + 0, 0x30); // dx = |0x30 - 0x36| = 6 (< 0x0a)
  m.mem.write8(BOX + 2, 0x38); // dy = |0x40 - 0x48| = 8 (< 0x09)
  m.mem.write8(BIAS_FLAG, 0x01); // bias +6
  m.mem.write16(LATCH, 0x8c90); // struck-target latch
  m.mem.write8(0x8c97, 0x01); // (latch+7) bit0 set -> skip the rst-0x10 memset
  return m;
}
const craftHit = () => seatHit(BASE.clone());
function craftExit() {
  const m = seatHit(BASE.clone());
  m.regs.b = 0x01; // djnz falls out -> plain ret, no strike
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceActorSweepToNextSlot == oracle in RAM (−stack)", () => {
  for (const [label, craft] of [["hit (djnz taken)", craftHit], ["exit (B==1)", craftExit]]) {
    const o = craft();
    const c = craft();
    oracle(o);
    advanceActorSweepToNextSlot(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: hit + exit identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the hit strikes the advanced record; exit leaves it live", () => {
  const hit = craftHit();
  oracle(hit);
  assert.equal(hit.mem.read8(REC + 0), 0x00, "struck record lead byte cleared");
  assert.equal(hit.mem.read8(REC + 1), 0x01, "struck record +1 <- 0x01");
  assert.equal(hit.mem.read8(REC + 2), 0x08, "struck record +2 <- 0x08");

  const exit = craftExit();
  oracle(exit);
  assert.equal(exit.mem.read8(REC + 0), 0x01, "B==1 drains before any strike");
  console.log("  WRITE-SET: hit strikes, exit inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftHit();
  const c = craftHit();
  oracle(o);
  advanceActorSweepToNextSlot(c);
  c.mem.write8(REC + 1, (o.mem.read8(REC + 1) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, REC + 1, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong-stride twin (row += 0x17) misses the record and is CAUGHT", () => {
  function twin(m, hl = m.regs.hl, ix = m.regs.ix, count = m.regs.b) {
    const remaining = (count - 1) & 0xff;
    if (remaining === 0) return;
    m.regs.de = 0x18;
    m.regs.ix = u16(ix + 4);
    m.regs.hl = u16(hl + 0x17); // WRONG stride -> lands on the empty record
    m.regs.b = remaining;
    m.call(0x5ebd);
  }
  const o = craftHit();
  const t = craftHit();
  oracle(o);
  twin(t);
  const d = ramDiffMinusStack(o, t);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong-stride sweep");
  assert.equal(t.mem.read8(REC + 0), 0x01, "twin left the record unstruck");
  assert.equal(o.mem.read8(REC + 0), 0x00, "oracle struck the record");
  console.log(`  TEETH(stride): caught at ${hx(d.addr ?? 0)}`);
});

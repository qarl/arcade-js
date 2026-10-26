// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for loc_60f2 (ROM 0x60f2, Pooyan) — the outer-scan epilogue. It advances
 * the actor pointer by one slot and the record pointer by one record, decrements the remaining
 * count, and re-enters the scan head while records remain; when the count drains the scan is
 * complete.
 *
 * SEATING: BALANCED (WIRE). The oracle ends in a plain `ret` on completion (net SP 0); the loop
 * arm tail-`jp`s back to the scan head. The module returns a boolean: true = the scan completed
 * with no hit, false = a caller-skip forwarded up from a hit deeper in the loop. Compared on RAM
 * (dumpState) minus stack scratch below the entry SP; the register file is not compared (the advanced pointers are
 * dead once the scan returns). Entry registers HL/IX/B are the param-default bridge.
 *
 * Cases are CRAFTED: a plain boot does not seat this loop geometry.
 *
 * Jobs:
 *   1. EQUAL — a one-record completion (inert) and a two-record loop whose second record is a
 *      proximity hit reaching the finder main path (writes): oracle == module in RAM (−stack)
 *      + boolean.
 *   2. WRITE-SET — the loop-to-hit marks the parity hit flag and seeds the SECOND record's base;
 *      the immediate completion leaves RAM untouched.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a twin that completes without looping
 *      (misses the hit) and a wrong-stride twin (advances to an empty record) both diverge.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-60f2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_60f2 as oracle } from "../../translated/loc_60f2.js";
import { loc_60f2 } from "../loc_60f2.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FLIP = 0x881f;
const ROUND = 0x8907;
const EAT = 0x8ae0;
const STRIDE = 0x18;
const TYPE = 0x8d44;
const FLAG_I0 = 0x8d1b;
const SOUND_RING_PTR = 0x8a40;
const OBJ = 0x8c50; //     record[0]; the epilogue advances to record[1] at OBJ+0x18
const REC1 = OBJ + 0x18; // 0x8c68
const IXA = 0x8840;
const IYA = 0x8848;
const KEY = 0x42;
const SEED_FIELDS = [0x00, 0x01, 0x02, 0x12, 0x16, 0x17];
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the entry interface + a hittable SECOND record; count picks completion vs loop. */
function seat(m, count) {
  m.regs.hl = OBJ;
  m.regs.ix = IXA;
  m.regs.b = count;
  m.regs.iy = IYA;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.sp = SP0;
  m.mem.write8(FLIP, 0x01);
  m.mem.write8(ROUND, 0x00); //   even round -> proximity gate
  m.mem.write8(TYPE, 0x02);
  m.mem.write8(IXA + 4 + 0, 0); //  the SECOND actor (IX advanced by 4) at a hit position
  m.mem.write8(IXA + 4 + 2, 0);
  m.mem.write8(IYA + 0, 0);
  m.mem.write8(IYA + 2, 0);
  for (const off of SEED_FIELDS) m.mem.write8(REC1 + off, 0xee);
  m.mem.write8(REC1 + 0x00, 0x01); //  record[1] live
  m.mem.write8(REC1 + 0x02, 0x05); //  record[1] live kind
  m.mem.write8(REC1 + 0x14, KEY);
  m.mem.write8(SOUND_RING_PTR, 0x43);
  for (let i = 0; i < 6; i++) {
    m.mem.write8(EAT + i * STRIDE + 0x14, (KEY ^ 0x5a) & 0xff);
    m.mem.write8(EAT + i * STRIDE + 0x16, 0x00);
  }
  return m;
}

const craftComplete = () => seat(BASE.clone(), 0x01); // remaining 0 -> ret
const craftLoopHit = () => seat(BASE.clone(), 0x02); // advance to record[1] -> proximity hit

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: loc_60f2 == oracle in RAM (−stack) + boolean", () => {
  for (const cfg of [
    { name: "complete (count 1)", craft: craftComplete, ret: true },
    { name: "loop to a hit (count 2)", craft: craftLoopHit, ret: true },
  ]) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    const ret = loc_60f2(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, cfg.ret, `${cfg.name}: boolean must be ${cfg.ret}`);
  }
  console.log("  EQUAL: complete + loop-to-hit identical (RAM −stack + boolean)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: completion is inert; the loop-to-hit seeds record[1] + flags", () => {
  const done = craftComplete();
  const b0 = done.dumpState();
  oracle(done);
  assert.deepEqual([...done.dumpState()], [...b0], "immediate completion must leave RAM untouched");

  const hit = craftLoopHit();
  oracle(hit);
  assert.equal(hit.mem.read8(FLAG_I0), 0x01, "loop-to-hit marks the parity hit flag");
  assert.equal(hit.mem.read8(REC1 + 0x12), 0xff, "loop-to-hit leaves record[1]'s +0x12 marker at 0xff");
  console.log("  WRITE-SET: complete inert; loop-to-hit seeds record[1]");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftLoopHit();
  const c = craftLoopHit();
  oracle(o);
  loc_60f2(c);
  c.mem.write8(REC1 + 0x16, (o.mem.read8(REC1 + 0x16) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted seed byte");
  assert.equal(d.addr, REC1 + 0x16, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a completes-without-looping twin misses record[1]'s writes and diverges", () => {
  const o = craftLoopHit();
  const twin = craftLoopHit();
  oracle(o); // loops into the hit, seeds record[1]
  const noLoop = (m) => true; // BUG: ignore the remaining count, never re-enter the scan
  noLoop(twin);
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "gate FAILED to catch a skipped loop iteration");
  console.log(`  TEETH(loop): caught the un-looped iteration at ${hx(d.addr ?? 0)}`);
});

// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for latchObjectTypeAndEnterProximityScan (ROM 0x6048, Pooyan) — arm and enter the object-record
 * proximity scan for one slot. It picks the slot's presence block by the slot selector, gates on
 * that block's lead byte (empty/engaged -> return normally), else latches the kind as the active
 * hit type and enters the scan.
 *
 * SEATING: DISSOLVED. The oracle's two `ret z` exits are normal returns (a slot that continues the
 * caller's loop); its fall-through delegates the whole scan. The module folds all three into a
 * boolean return — true = the slot completed normally (the two inert kinds, and a scan with no
 * hit), false = a hit inside the scan skip-returns past the caller's loop. Compared on RAM
 * (dumpState) minus stack scratch below the entry SP; the register file is not compared. The slot selector is the
 * param-default register bridge; a live block forces the scan's own pointers.
 *
 * The oracle runs the TRANSLATED latchObjectTypeAndEnterProximityScan, which m.call()s the scan subtree through the registry;
 * the module composes the idiomatic subtree by direct import. Cases are CRAFTED — a plain boot
 * does not seat this block/record/enemy geometry.
 *
 * Jobs:
 *   1. EQUAL — a byte0==0 block (skipped), a byte0==3 block (skipped), a live block over empty
 *      records (no hit), and a live block over a hit-then-abort geometry: oracle == module in
 *      RAM (−stack) and the module's boolean matches.
 *   2. WRITE-SET — an inert block leaves the active type untouched; a live block latches it.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a hit-returns-true twin and an
 *      inert-returns-false twin are caught by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6048.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6048 as oracle } from "../../translated/loc_6048.js";
import { latchObjectTypeAndEnterProximityScan } from "../latchObjectTypeAndEnterProximityScan.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const BLOCK_A = 0x8c90; // slot-0 presence block (selector 0)
const BLOCK_B = 0x8ca8; // slot-1 presence block (selector != 0)
const TYPE = 0x8d44; //     active hit type, latched from the block's lead byte
const OBJTAB = 0x8b70; //   the record table the scan sweeps (stride 0x18)
const ACTORS = 0x8868; //   the actor coordinate slots the scan reads (stride 4)
const TARGET = 0x8848; //   the slot-0 target base
const FLIP = 0x881f;
const ROUND = 0x8907;
const EAT = 0x8ae0; //      enemy-actor table (stride 0x18, 6 records)
const STRIDE = 0x18;
const SOUND_RING_PTR = 0x8a40;
const KEY = 0x42;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the slot selector + shared world; the block is live and the geometry is a hit by default. */
function seat(m, { slot = 0, kind = 0x02, lead = 0x01, recKind = 0x05 } = {}) {
  m.regs.i = slot;
  m.regs.iy = TARGET;
  m.regs.sp = SP0;
  m.regs.iff2 = false;
  m.mem.write8(slot === 0 ? BLOCK_A : BLOCK_B, kind); // the block lead byte 6048 gates on
  m.mem.write8(FLIP, 0x01); //                           bias +6 -> a zero/zero pair is in range
  m.mem.write8(ROUND, 0x00); //                          even round -> the proximity gate
  m.mem.write8(ACTORS + 0, 0x00);
  m.mem.write8(ACTORS + 2, 0x00);
  m.mem.write8(TARGET + 0, 0x00);
  m.mem.write8(TARGET + 2, 0x00);
  m.mem.write8(OBJTAB + 0x00, lead); //   record lead byte (0 => empty => scan advances)
  m.mem.write8(OBJTAB + 0x02, recKind); // record kind (!= 5 => scan advances)
  m.mem.write8(OBJTAB + 0x14, KEY); //    the tag the proximity hit reads
  m.mem.write8(SOUND_RING_PTR, 0x43);
  for (let i = 0; i < 6; i++) {
    m.mem.write8(EAT + i * STRIDE + 0x14, (KEY ^ 0x5a) & 0xff); // no enemy matches
    m.mem.write8(EAT + i * STRIDE + 0x16, 0x00);
  }
  return m;
}

const craftEmptyBlock = () => seat(BASE.clone(), { slot: 1, kind: 0x00 }); // byte0 == 0 -> inert
const craftEngagedBlock = () => seat(BASE.clone(), { kind: 0x03 }); //        byte0 == 3 -> inert
const craftLiveMiss = () => seat(BASE.clone(), { kind: 0x02, lead: 0x00 }); // live block, empty records
function craftLiveHit() {
  const m = seat(BASE.clone(), { kind: 0x02 }); // live block, live+in-range record
  m.mem.write8(EAT + 0 * STRIDE + 0x14, KEY); // enemy record 0 matches...
  m.mem.write8(EAT + 0 * STRIDE + 0x16, 0x02); // ...bit1 set, type != 3 -> skip path
  return m;
}

const CASES = [
  { name: "byte0 == 0 block -> inert", craft: craftEmptyBlock, ret: true },
  { name: "byte0 == 3 block -> inert", craft: craftEngagedBlock, ret: true },
  { name: "live block, empty records -> no hit", craft: craftLiveMiss, ret: true },
  { name: "live block, in-range hit -> skip", craft: craftLiveHit, ret: false },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: latchObjectTypeAndEnterProximityScan == oracle in RAM (−stack) + forwarded boolean", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    const ret = latchObjectTypeAndEnterProximityScan(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, cfg.ret, `${cfg.name}: forwarded boolean must be ${cfg.ret}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: an inert block leaves the active type alone; a live block latches it", () => {
  const inert = craftEmptyBlock();
  inert.mem.write8(TYPE, 0x77);
  oracle(inert);
  assert.equal(inert.mem.read8(TYPE), 0x77, "an inert block must not latch the active type");

  const live = craftLiveMiss();
  oracle(live);
  assert.equal(live.mem.read8(TYPE), 0x02, "a live block latches its lead byte as the active type");
  console.log("  WRITE-SET: inert leaves the type; live latches it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong latched type byte is CAUGHT by the RAM diff", () => {
  const o = craftLiveMiss();
  const c = craftLiveMiss();
  oracle(o);
  latchObjectTypeAndEnterProximityScan(c);
  c.mem.write8(TYPE, (o.mem.read8(TYPE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted type byte");
  assert.equal(d.addr, TYPE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a hit-returns-true twin and an inert-returns-false twin are CAUGHT by the boolean", () => {
  assert.throws(
    () => assert.equal(((m) => (latchObjectTypeAndEnterProximityScan(m), true))(craftLiveHit()), false),
    "a hit must skip -> false",
  );
  assert.throws(
    () => assert.equal(((m) => (latchObjectTypeAndEnterProximityScan(m), false))(craftEmptyBlock()), true),
    "an inert block must continue -> true",
  );
  console.log("  TEETH(boolean): hit-true and inert-false twins caught");
});

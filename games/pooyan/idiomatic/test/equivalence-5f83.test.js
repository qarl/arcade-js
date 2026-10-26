// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for latchObjectTypeAndScanEnemyRecords (ROM 0x5f83, Pooyan) — arm and enter the enemy-record
 * overlap scan for one interrupt-parity slot. It picks the slot's presence block by the parity
 * selector, gates on that block's lead byte (a zero block -> return normally), else latches the
 * kind as the active hit type and enters the six-record overlap scan.
 *
 * SEATING: DISSOLVED. The oracle's early `ret z` is a normal return (a slot that continues the
 * caller's loop); its fall-through delegates the whole scan, whose hit path does `pop af; ret` and
 * skip-returns +4 SP past the caller's loop (measured: an inert/miss slot nets SP+2, a hit nets
 * SP+4). The module folds both into a boolean return — true = the slot completed normally (the
 * inert block, and a scan with no hit), false = a hit inside the scan skip-returns past the
 * caller's loop. Needs-caller-lifted: sweepBothActorRecordSlotsForHit's loop tests `m.pc !== 0x5f7a` and propagates.
 * Compared on RAM (dumpState) minus stack scratch below the entry SP; the register file is not compared. The slot
 * selector and target box are the param-default register bridge.
 *
 * The oracle runs the TRANSLATED latchObjectTypeAndScanEnemyRecords, which m.call()s the scan subtree (testRecordOverlapRetireOrFlagHit -> advanceOverlapScanToNextSlot/
 * queueSoundCommand09) through the registry; the module composes the idiomatic subtree by direct import of
 * testRecordOverlapRetireOrFlagHit (a batch sibling — this gate is green once testRecordOverlapRetireOrFlagHit and the ENEMY_SCAN_BOX_TABLE cell
 * land). Cases are CRAFTED — a plain boot does not seat this block/box/enemy geometry.
 *
 * Jobs:
 *   1. EQUAL — a byte0==0 block (inert), a live block over empty records (no hit), and a live
 *      block over a hit-then-skip geometry: oracle == module in RAM (−stack) and the boolean matches.
 *   2. WRITE-SET — an inert block leaves the active type untouched; a live block latches it; a hit
 *      marks the two struck-record cells.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a hit-returns-true twin and an
 *      inert-returns-false twin are caught by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5f83.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5f83 as oracle } from "../../translated/loc_5f83.js";
import { latchObjectTypeAndScanEnemyRecords } from "../latchObjectTypeAndScanEnemyRecords.js";
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
const EAT = 0x8ae0; //      enemy-actor scan table (stride 0x18, 6 records)
const BOX = 0x8850; //      the coordinate boxes the scan reads (stride 4)
const TARGET = 0x8848; //   the slot-0 target box
const FLIP = 0x881f; //     x-bias selector (nonzero -> +6)
const HIT_A = 0x8c91; //    struck-record cell (target low == 0x48 branch)
const HIT_B = 0x8c97; //    the +6 partner cell the hit also flags
const STRIDE = 0x18;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the slot selector + shared world; the block is live and the geometry is a hit by default. */
function seat(m, { slot = 0, kind = 0x02, lead = 0x01, recType = 0x05 } = {}) {
  m.regs.i = slot;
  m.regs.iy = TARGET;
  m.regs.sp = SP0;
  m.regs.iff2 = false;
  m.mem.write8(slot === 0 ? BLOCK_A : BLOCK_B, kind); // the block lead byte the routine gates on
  m.mem.write8(FLIP, 0x01); //                          nonzero bias +6 -> a zero/zero pair is in range
  m.mem.write8(TARGET + 0, 0x00);
  m.mem.write8(TARGET + 2, 0x00);
  for (let i = 0; i < 6; i++) {
    m.mem.write8(BOX + i * 4 + 0, 0x00); //  coordinate box x
    m.mem.write8(BOX + i * 4 + 2, 0x00); //  coordinate box y
    m.mem.write8(EAT + i * STRIDE + 0, lead); //     record lead byte (0 => empty => scan advances)
    m.mem.write8(EAT + i * STRIDE + 2, recType); //  record type (!= 5 => scan advances)
  }
  return m;
}

const craftInert = () => seat(BASE.clone(), { slot: 1, kind: 0x00 }); //         byte0 == 0 -> inert
const craftLiveMiss = () => seat(BASE.clone(), { kind: 0x02, lead: 0x00 }); //   live block, empty records
const craftLiveHit = () => seat(BASE.clone(), { kind: 0x02 }); //                live block, in-range type-5 record

const CASES = [
  { name: "byte0 == 0 block -> inert", craft: craftInert, ret: true },
  { name: "live block, empty records -> no hit", craft: craftLiveMiss, ret: true },
  { name: "live block, in-range hit -> skip", craft: craftLiveHit, ret: false },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: latchObjectTypeAndScanEnemyRecords == oracle in RAM (−stack) + forwarded boolean", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    const ret = latchObjectTypeAndScanEnemyRecords(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, cfg.ret, `${cfg.name}: forwarded boolean must be ${cfg.ret}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: an inert block leaves the type alone; a live block latches; a hit flags the cells", () => {
  const inert = craftInert();
  inert.mem.write8(TYPE, 0x77);
  oracle(inert);
  assert.equal(inert.mem.read8(TYPE), 0x77, "an inert block must not latch the active type");

  const live = craftLiveMiss();
  oracle(live);
  assert.equal(live.mem.read8(TYPE), 0x02, "a live block latches its lead byte as the active type");

  const hit = craftLiveHit();
  oracle(hit);
  assert.equal(hit.mem.read8(HIT_A), 0x01, "a hit flags the struck-record cell");
  assert.equal(hit.mem.read8(HIT_B), 0x01, "a hit flags the partner cell");
  console.log("  WRITE-SET: inert leaves the type; live latches; hit flags both cells");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong latched type byte is CAUGHT by the RAM diff", () => {
  const o = craftLiveMiss();
  const c = craftLiveMiss();
  oracle(o);
  latchObjectTypeAndScanEnemyRecords(c);
  c.mem.write8(TYPE, (o.mem.read8(TYPE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted type byte");
  assert.equal(d.addr, TYPE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a hit-returns-true twin and an inert-returns-false twin are CAUGHT by the boolean", () => {
  assert.throws(
    () => assert.equal(((m) => (latchObjectTypeAndScanEnemyRecords(m), true))(craftLiveHit()), false),
    "a hit must skip -> false",
  );
  assert.throws(
    () => assert.equal(((m) => (latchObjectTypeAndScanEnemyRecords(m), false))(craftInert()), true),
    "an inert block must continue -> true",
  );
  console.log("  TEETH(boolean): hit-true and inert-false twins caught");
});

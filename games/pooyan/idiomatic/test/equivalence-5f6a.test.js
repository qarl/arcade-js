// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for sweepBothActorRecordSlotsForHit (ROM 0x5f6a, Pooyan) — the ungated two-pass actor-slot
 * sweep. It walks the two actor-record slots (base +0 then +4) through the per-slot handler with
 * the interrupt-parity selector 0 then non-zero, aborting the instant a pass claims a hit.
 *
 * SEATING: BALANCED (plain ret). The module drives the idiomatic per-slot handler sibling and
 * aborts on its `false` (hit-claimed) return, mirroring the projectile-proximity driver's shape;
 * the oracle drives the translated handler through the routines map. sweepBothActorRecordSlotsForHit is a void sweep — no
 * register survives — so equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in
 * STACK_SCRATCH so the handler's nested pushes drop out of the diff.
 *
 * ⚠ CROSS-AGENT: the idiomatic per-slot handler (latchObjectTypeAndScanEnemyRecords) is an in-batch sibling. This gate
 * assumes it lands with the family contract `(m, cursor, selector)` returning true=continue /
 * false=hit-claimed, exactly like the proximity driver's seeder. If the sibling's signature or
 * boolean polarity differs the LEAD reconciles at merge.
 *
 * Each active slot's per-slot handler writes the slot's lead byte to 0x8d44 before its miss scan,
 * so the sweep's own job — visiting BOTH slots in order and stopping on a hit — is observable at
 * 0x8d44: a full miss sweep leaves the SECOND slot's value there.
 *
 * Jobs:
 *   1. EQUAL — both slots active (miss), first slot only, both empty: module == oracle in RAM.
 *   2. WRITE-SET — a two-slot miss sweep leaves the second slot's lead byte at 0x8d44.
 *   3. TEETH — a wrong-byte RAM twin is caught; a single-pass twin (handler run once) leaves the
 *      FIRST slot's value at 0x8d44 and diverges from the oracle there.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5f6a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5f6a as oracle } from "../../translated/loc_5f6a.js";
import { sweepBothActorRecordSlotsForHit } from "../sweepBothActorRecordSlotsForHit.js";
import { latchObjectTypeAndScanEnemyRecords } from "../latchObjectTypeAndScanEnemyRecords.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPRITE_ACTOR_RECORD_SLOTS } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SLOT0 = 0x8c90; //  first actor slot's lead byte (I=0 selector)
const SLOT1 = 0x8ca8; //  second actor slot's lead byte (non-zero selector)
const TYPE = 0x8d44; //   per-slot handler writes the active slot's lead byte here before its scan
const LEAD0 = 0xaa;
const LEAD1 = 0xbb;
const SP0 = 0x8ff0; //    inside STACK_SCRATCH

const SCAN_REC = 0x8ae0; //   record table the overlap scan walks (stride 0x18); +0 lead, +2 type
const SCAN_POS = 0x8850; //   position-box table walked in lockstep (stride 0x04); +0 X, +2 Y
const REC_STRIDE = 0x18;
const POS_STRIDE = 0x04;
const TARGET_BOX = SPRITE_ACTOR_RECORD_SLOTS; // first pass's target box (low byte 0x48 picks HIT_CELL)
const FLIP = 0x881f; //       screen-flip flag: nonzero -> +6 X bias (deterministic)
const HIT_CELL = 0x8c91; //   struck-record cell a first-pass general overlap flags
const PARTNER = 0x06; //      the struck cell's partner offset
const STALE_IY = 0x8820; //   a box overlapping nothing — what the never-published iy reads under the bug

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(m, { lead0 = LEAD0, lead1 = LEAD1 } = {}) {
  m.regs.sp = SP0;
  m.mem.write8(SLOT0, lead0);
  m.mem.write8(SLOT1, lead1);
  return m;
}

const craftBoth = () => seat(BASE.clone());
const craftSlot0 = () => seat(BASE.clone(), { lead1: 0x00 });
const craftEmpty = () => seat(BASE.clone(), { lead0: 0x00, lead1: 0x00 });

// A first-pass sweep whose only overlapping record sits at scan SLOT 1 — reachable only through the
// scan's loop re-entry, which reads the target box back from iy. Slot 0 is empty (advances), so a
// driver that never publishes iy reads STALE_IY for slot 1 and misses the overlap the oracle claims.
function craftScanHit() {
  const m = craftBoth(); // both presence blocks live; the first pass keys off SLOT0's lead byte
  m.regs.iy = STALE_IY; // the never-published register the buggy sweep leaves in place
  m.mem.write8(STALE_IY, 0x00); // a target box far from the record -> dx huge
  m.mem.write8(STALE_IY + 2, 0x00);
  m.mem.write8(FLIP, 0x01); // deterministic +6 X bias
  m.mem.write8(SCAN_REC, 0x00); // slot 0 record empty -> advance to slot 1
  const rec1 = SCAN_REC + REC_STRIDE;
  const pos1 = SCAN_POS + POS_STRIDE;
  m.mem.write8(rec1, 0x01); // slot 1 record non-empty ...
  m.mem.write8(rec1 + 2, 0x05); // ... and the type the scan considers
  m.mem.write8(pos1, 0x40); // posX raw; +6 bias -> 0x46
  m.mem.write8(pos1 + 2, 0x60); // posY raw
  m.mem.write8(TARGET_BOX, 0x46); // target X == biased posX -> dx 0
  m.mem.write8(TARGET_BOX + 2, 0x60); // target Y == posY -> dy 0
  for (let k = 2; k < 6; k++) m.mem.write8(SCAN_REC + k * REC_STRIDE, 0x00); // remaining slots inert
  return m;
}

const CASES = [
  { name: "both slots active (miss) -> second lead wins", craft: craftBoth },
  { name: "first slot only -> first lead", craft: craftSlot0 },
  { name: "both empty -> inert", craft: craftEmpty },
  { name: "slot-1 overlap -> first-pass hit (iy must track the target box)", craft: craftScanHit },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: sweepBothActorRecordSlotsForHit == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    sweepBothActorRecordSlotsForHit(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} sweeps identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a two-slot miss sweep leaves the second slot's lead byte at 0x8d44", () => {
  const c = craftBoth();
  sweepBothActorRecordSlotsForHit(c);
  assert.equal(c.mem.read8(TYPE), LEAD1, "both passes must run -> the second slot's lead byte lands last");

  const empty = craftEmpty();
  const b0 = empty.dumpState();
  sweepBothActorRecordSlotsForHit(empty);
  assert.deepEqual([...empty.dumpState()], [...b0], "two empty slots leave RAM untouched");
  console.log("  WRITE-SET: second-slot lead at 0x8d44; empty inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftBoth();
  const c = craftBoth();
  oracle(o);
  sweepBothActorRecordSlotsForHit(c);
  c.mem.write8(TYPE, (o.mem.read8(TYPE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, TYPE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a single-pass twin leaves the first slot's value and diverges from the two-pass oracle", () => {
  const o = craftBoth();
  const twin = craftBoth();
  oracle(o); // both passes -> 0x8d44 = second lead
  latchObjectTypeAndScanEnemyRecords(twin, 0x00, SPRITE_ACTOR_RECORD_SLOTS); // a driver that ran only the first pass (selector 0, cursor base)
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a single-pass sweep");
  assert.equal(d.addr, TYPE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(loop): single-pass caught at ${hx(d.addr)}`);
});

test("TEETH(stale-iy): the slot-1 overlap fires only when iy tracks each pass's target box", () => {
  // positive control: the oracle republishes the target box every slot, so it claims the slot-1 hit
  const o = craftScanHit();
  oracle(o);
  assert.equal(o.mem.read8(HIT_CELL), 0x01, "control: the oracle must register the slot-1 overlap");
  assert.equal(o.mem.read8(HIT_CELL + PARTNER), 0x01, "control: the oracle must flag the struck cell's partner");
  assert.equal(o.mem.read8(TYPE), LEAD0, "control: the first-pass hit must abort before the second pass runs");

  // the module must reach the SAME hit; a stale target box misses it and leaves HIT_CELL clear
  const c = craftScanHit();
  sweepBothActorRecordSlotsForHit(c);
  assert.equal(c.mem.read8(HIT_CELL), 0x01, "module missed the slot-1 overlap -> stale target box (iy never published)");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `stale-iy divergence at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  TEETH(stale-iy): slot-1 overlap fires; module tracks the oracle");
});

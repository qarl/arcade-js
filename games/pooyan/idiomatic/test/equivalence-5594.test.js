// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seedFirstFreeSlotForTimedSpawnWithTamperCheck (ROM 0x5594, Pooyan) — scan an actor-block table, run the
 * anti-tamper guard-sum, seed the first free slot. Live blocks ((blk+0)|(blk+1) != 0) are skipped
 * (cursor += stride, count times). At the first free block it sums the 8-byte INTEGRITY_GUARD_REGION
 * against INTEGRITY_GUARD_SIGNATURE; any nonzero pair bumps TAMPER_FREEZE_FLAG. Then it seeds the kind
 * byte (blk+0x17) from SPAWN_KIND_TABLE_5627 via rst 0x20 and hands the record to initSpawnedActorRecordAndDeriveSpeed, which
 * caller-skips (pop af; ret) past seedFirstFreeSlotForTimedSpawnWithTamperCheck. No free block -> the scan falls out.
 *
 * Compared on RAM (dumpState) minus stack scratch below the entry SP; register file not compared (LIVE-OUT: none). The
 * guard region + signature live in ROM, so the guard-sum arm is whatever the built ROM produces —
 * oracle and module read the same ROM and must agree; TAMPER_FREEZE_FLAG is pre-seeded so any bump is
 * visible in the diff. The test requires the built ROM.
 *
 * Jobs:
 *   1. EQUAL — FREE-FIRST, LIVE-then-FREE, ALL-LIVE across index values: oracle == module.
 *   2. WRITE-SET — the seeded kind byte (blk+0x17) equals the rst-0x20 table byte.
 *   3. TEETH — a wrong kind byte, a cleared active flag, and a wrong tamper tally are each caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5594.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5594 as oracle } from "../../translated/loc_5594.js";
import { seedFirstFreeSlotForTimedSpawnWithTamperCheck } from "../seedFirstFreeSlotForTimedSpawnWithTamperCheck.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPAWN_SEQUENCE_INDEX_8D14, SPAWN_KIND_TABLE_5627, TAMPER_FREEZE_FLAG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c60; //         actor-block table base (spawnFormationEnemiesOnTimer's real IX)
const STRIDE = 0x18; //        block stride
const KIND_FIELD = 0x17; //    blk+0x17 = seeded kind byte
const ACTIVE_FLAG = 0x00; //   blk+0x00 = 1 (set by initSpawnedActorRecordAndDeriveSpeed)
const ROUND_COUNTER = 0x8907;
const TALLY_SEED = 0x07; //    baseline for TAMPER_FREEZE_FLAG so any bump shows in the diff
const SP0 = 0x8fe0; //         inside STACK_SCRATCH so the oracle's push/pop churn is excluded

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craft(count, liveMask, spawnIndex, round) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.de = STRIDE;
  m.regs.b = count & 0xff;
  m.regs.sp = SP0;
  m.mem.write8(SPAWN_SEQUENCE_INDEX_8D14, spawnIndex & 0xff);
  m.mem.write8(ROUND_COUNTER, round & 0xff);
  m.mem.write8(TAMPER_FREEZE_FLAG, TALLY_SEED);
  for (let i = 0; i < count; i++) {
    m.mem.write8((REC + i * STRIDE) & 0xffff, liveMask[i] & 0xff);
    m.mem.write8((REC + i * STRIDE + 1) & 0xffff, 0x00);
  }
  return m;
}

const kindByte = (m) =>
  m.mem.read8((SPAWN_KIND_TABLE_5627 + (m.mem.read8(SPAWN_SEQUENCE_INDEX_8D14) & 0x0f)) & 0xffff);

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: FREE-FIRST / LIVE-then-FREE / ALL-LIVE — seedFirstFreeSlotForTimedSpawnWithTamperCheck == oracle in RAM (−stack)", () => {
  const cases = [
    { count: 1, live: [0x00], idx: 0x02, round: 0x00 }, // free on iter 1 -> guard-sum + seed
    { count: 3, live: [0x01, 0x00, 0x00], idx: 0x05, round: 0x02 }, // skip one live, seed the second
    { count: 4, live: [0x80, 0x01, 0x00, 0x00], idx: 0x0e, round: 0x07 }, // skip two live, seed the third
    { count: 2, live: [0x01, 0x01], idx: 0x00, round: 0x00 }, // all live -> no seed, no guard-sum
    { count: 1, live: [0x00], idx: 0x0f, round: 0x0e }, // top of the index nibble
  ];
  for (const { count, live, idx, round } of cases) {
    const o = craft(count, live, idx, round);
    const c = craft(count, live, idx, round);
    oracle(o);
    seedFirstFreeSlotForTimedSpawnWithTamperCheck(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null,
      d && `count=${count} idx=${hx(idx)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${cases.length} scan/guard/seed scenarios identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the free block's kind byte (blk+0x17) is the rst-0x20 table byte", () => {
  const c = craft(1, [0x00], 0x02, 0x05);
  const expected = kindByte(c);
  seedFirstFreeSlotForTimedSpawnWithTamperCheck(c);
  assert.equal(c.mem.read8((REC + KIND_FIELD) & 0xffff), expected,
    `blk+0x17 must be SPAWN_KIND_TABLE_5627[idx] = ${hx(expected)}`);
  assert.equal(c.mem.read8((REC + ACTIVE_FLAG) & 0xffff), 0x01, "initSpawnedActorRecordAndDeriveSpeed must set the active flag");
  console.log(`  WRITE-SET: seeded kind byte ${hx(expected)}, active flag set`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded kind byte is CAUGHT by the RAM diff", () => {
  const o = craft(1, [0x00], 0x02, 0x05);
  const c = craft(1, [0x00], 0x02, 0x05);
  oracle(o);
  seedFirstFreeSlotForTimedSpawnWithTamperCheck(c);
  const correct = c.mem.read8((REC + KIND_FIELD) & 0xffff);
  c.mem.write8((REC + KIND_FIELD) & 0xffff, correct ^ 0xff); // BUG: seed byte must be the table fetch
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong kind byte");
  assert.equal(d.addr, (REC + KIND_FIELD) & 0xffff, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(kind): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a cleared active flag is CAUGHT by the RAM diff", () => {
  const o = craft(1, [0x00], 0x02, 0x05);
  const c = craft(1, [0x00], 0x02, 0x05);
  oracle(o);
  seedFirstFreeSlotForTimedSpawnWithTamperCheck(c);
  c.mem.write8((REC + ACTIVE_FLAG) & 0xffff, 0x00); // BUG: initSpawnedActorRecordAndDeriveSpeed must set the active flag to 1
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a cleared active flag");
  assert.equal(d.addr, (REC + ACTIVE_FLAG) & 0xffff, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(active): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong tamper tally (TAMPER_FREEZE_FLAG) is CAUGHT by the RAM diff", () => {
  const o = craft(1, [0x00], 0x02, 0x05);
  const c = craft(1, [0x00], 0x02, 0x05);
  oracle(o);
  seedFirstFreeSlotForTimedSpawnWithTamperCheck(c);
  const correct = c.mem.read8(TAMPER_FREEZE_FLAG);
  c.mem.write8(TAMPER_FREEZE_FLAG, (correct + 1) & 0xff); // BUG: guard-sum must bump the tally exactly
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong tamper tally");
  assert.equal(d.addr, TAMPER_FREEZE_FLAG, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(tamper): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

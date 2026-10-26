// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seedFirstFreeSlotForScheduledSpawn (ROM 0x5544, Pooyan) — scan an actor-block table, seed the
 * first free slot. Live blocks ((blk+0)|(blk+1) != 0) are skipped (cursor += stride, count times); the
 * first free block is seeded ((blk+0x17) from SPAWN_KIND_TABLE_5647 via rst 0x20) and initialised by
 * initSpawnedActorRecordAndDeriveSpeed, which caller-skips (pop af; ret) past seedFirstFreeSlotForScheduledSpawn. No free block -> the scan falls out.
 *
 * Compared on RAM (dumpState) minus stack scratch below the entry SP; the register file is not compared (LIVE-OUT: none).
 * The oracle drives its rst-0x20 + initSpawnedActorRecordAndDeriveSpeed via the translated registry; the module calls the idiomatic
 * fetchByteFromTableIndex/initSpawnedActorRecordAndDeriveSpeed directly. Both read ROM tables, so the test requires the built ROM.
 *
 * Jobs:
 *   1. EQUAL — FREE-FIRST, LIVE-then-FREE, ALL-LIVE across index/round values: oracle == module.
 *   2. WRITE-SET — the seeded kind byte (blk+0x17) equals the table byte the rst-0x20 lookup fetches.
 *   3. TEETH — a wrong seeded kind byte and a cleared active flag are each caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5544.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5544 as oracle } from "../../translated/loc_5544.js";
import { seedFirstFreeSlotForScheduledSpawn } from "../seedFirstFreeSlotForScheduledSpawn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPAWN_SEQUENCE_INDEX_8D13, SPAWN_KIND_TABLE_5647 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c48; //         actor-block table base (spawnShotTargetOnInterval's real IX)
const STRIDE = 0x18; //        block stride
const KIND_FIELD = 0x17; //    blk+0x17 = seeded kind byte
const ACTIVE_FLAG = 0x00; //   blk+0x00 = 1 (set by initSpawnedActorRecordAndDeriveSpeed)
const ROUND_COUNTER = 0x8907;
const SP0 = 0x8fe0; //         inside STACK_SCRATCH so the oracle's push/pop churn is excluded

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with the scan inputs (IX/DE/B) + the spawn cursor + round counter seated, and each
 *  block's liveness byte written (liveMask[i] != 0 -> block i is live). */
function craft(count, liveMask, spawnIndex, round) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.de = STRIDE;
  m.regs.b = count & 0xff;
  m.regs.sp = SP0;
  m.mem.write8(SPAWN_SEQUENCE_INDEX_8D13, spawnIndex & 0xff);
  m.mem.write8(ROUND_COUNTER, round & 0xff);
  for (let i = 0; i < count; i++) {
    m.mem.write8((REC + i * STRIDE) & 0xffff, liveMask[i] & 0xff);
    m.mem.write8((REC + i * STRIDE + 1) & 0xffff, 0x00);
  }
  return m;
}

const kindByte = (m, spawnIndex) =>
  m.mem.read8((SPAWN_KIND_TABLE_5647 + (m.mem.read8(SPAWN_SEQUENCE_INDEX_8D13) & 0x0f)) & 0xffff);

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: FREE-FIRST / LIVE-then-FREE / ALL-LIVE — seedFirstFreeSlotForScheduledSpawn == oracle in RAM (−stack)", () => {
  const cases = [
    { count: 1, live: [0x00], idx: 0x03, round: 0x00 }, // free on iter 1 -> seed
    { count: 3, live: [0x01, 0x00, 0x00], idx: 0x05, round: 0x02 }, // skip one live, seed the second
    { count: 4, live: [0x80, 0x01, 0x00, 0x00], idx: 0x0e, round: 0x07 }, // skip two live, seed the third
    { count: 2, live: [0x01, 0x01], idx: 0x00, round: 0x00 }, // all live -> no seed
    { count: 1, live: [0x00], idx: 0x0f, round: 0x0e }, // top of the index nibble
  ];
  for (const { count, live, idx, round } of cases) {
    const o = craft(count, live, idx, round);
    const c = craft(count, live, idx, round);
    oracle(o);
    seedFirstFreeSlotForScheduledSpawn(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null,
      d && `count=${count} idx=${hx(idx)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${cases.length} scan/seed scenarios identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the free block's kind byte (blk+0x17) is the rst-0x20 table byte", () => {
  const idx = 0x03;
  const c = craft(1, [0x00], idx, 0x05);
  const expected = kindByte(c, idx);
  seedFirstFreeSlotForScheduledSpawn(c);
  assert.equal(c.mem.read8((REC + KIND_FIELD) & 0xffff), expected,
    `blk+0x17 must be SPAWN_KIND_TABLE_5647[idx] = ${hx(expected)}`);
  assert.equal(c.mem.read8((REC + ACTIVE_FLAG) & 0xffff), 0x01, "initSpawnedActorRecordAndDeriveSpeed must set the active flag");
  console.log(`  WRITE-SET: seeded kind byte ${hx(expected)}, active flag set`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded kind byte is CAUGHT by the RAM diff", () => {
  const o = craft(1, [0x00], 0x03, 0x05);
  const c = craft(1, [0x00], 0x03, 0x05);
  oracle(o);
  seedFirstFreeSlotForScheduledSpawn(c);
  const correct = c.mem.read8((REC + KIND_FIELD) & 0xffff);
  c.mem.write8((REC + KIND_FIELD) & 0xffff, correct ^ 0xff); // BUG: seed byte must be the table fetch
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong kind byte");
  assert.equal(d.addr, (REC + KIND_FIELD) & 0xffff, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(kind): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a cleared active flag is CAUGHT by the RAM diff", () => {
  const o = craft(1, [0x00], 0x03, 0x05);
  const c = craft(1, [0x00], 0x03, 0x05);
  oracle(o);
  seedFirstFreeSlotForScheduledSpawn(c);
  c.mem.write8((REC + ACTIVE_FLAG) & 0xffff, 0x00); // BUG: initSpawnedActorRecordAndDeriveSpeed must set the active flag to 1
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a cleared active flag");
  assert.equal(d.addr, (REC + ACTIVE_FLAG) & 0xffff, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(active): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

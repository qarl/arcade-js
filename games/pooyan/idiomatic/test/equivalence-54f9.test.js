// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seedFirstFreeActorBlockFromSpawnTypeTable (ROM 0x54f9, Pooyan) — "spawn-slot scan": walk B blocks at
 * IX stepping DE each pass, and seed one actor into the first block whose first two bytes are both
 * zero.
 *
 * seedFirstFreeActorBlockFromSpawnTypeTable is the CALLER of the dissolved caller-skip initSpawnedActorRecordAndDeriveSpeed (the block seeder, which pop-af/rets
 * to seedFirstFreeActorBlockFromSpawnTypeTable's own caller). This gate COMPOSES the real idiomatic path: the idiomatic seedFirstFreeActorBlockFromSpawnTypeTable
 * picks the kind byte via the idiomatic table-index helper (fetchByteFromTableIndex), writes it to the block's
 * kind field, then calls the idiomatic initSpawnedActorRecordAndDeriveSpeed and returns — exactly where the oracle's rst-20 +
 * call/pop-af aborted the scan. The oracle side runs the TRANSLATED seedFirstFreeActorBlockFromSpawnTypeTable, which m.call()s the
 * translated fetchByteFromTableIndex / initSpawnedActorRecordAndDeriveSpeed through the registry.
 *
 * Cycle-free / memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). pc/SP/cycles/registers are NOT compared (seedFirstFreeActorBlockFromSpawnTypeTable has no register live-out — the
 * seed's caller reads only memory). Inputs are the block pointer (IX), the stride (DE) and the
 * count (B), bridged via the register defaults, plus the block bytes, the schedule cursor
 * (0x8d12) and the round counter (0x8907) poked identically on both sides.
 *
 * NOTE: the free-slot cases compose the sibling idiomatic initSpawnedActorRecordAndDeriveSpeed; they turn green once that
 * module lands (the LEAD runs the gate in reconcile). The all-live case is self-contained.
 *
 * Jobs: 1. EQUAL (all-live no-write; seed pass 1; step twice then seed pass 3). 2. WRITE-SET
 * (all-live writes nothing; a free block stamps the kind field). 3. TEETH (a wrong kind byte and
 * a wrong seeded field are caught by the RAM diff).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-54f9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_54f9 as oracle } from "../../translated/loc_54f9.js";
import { seedFirstFreeActorBlockFromSpawnTypeTable } from "../seedFirstFreeActorBlockFromSpawnTypeTable.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, FORMATION_TABLE, ROUND_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const BASE_BLOCK = FORMATION_TABLE; // 0x8c30
const STRIDE = 0x18;
const KIND_FIELD = 0x17;
const CURSOR = 0x8d12; // schedule cursor (low nibble indexes the spawn-type table)
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const blockBase = (k) => u16(BASE_BLOCK + k * STRIDE); // block scanned on pass k (0-based)

/** A fresh clone: IX/DE/B seated, cursor + round poked, and the listed blocks marked live. */
function craft(liveIndices, count, { cursor = 0x00, round = 0x00 } = {}) {
  const m = BASE.clone();
  m.regs.ix = BASE_BLOCK;
  m.regs.de = STRIDE;
  m.regs.b = count;
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH
  m.mem.write8(CURSOR, cursor);
  m.mem.write8(ROUND_COUNTER, round);
  for (const k of liveIndices) m.mem.write8(blockBase(k) + 0x00, 0x01); // nonzero -> live block
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: single live block — scan finds no free slot, no writes", () => {
  const o = craft([0], 0x01);
  const c = craft([0], 0x01);
  oracle(o);
  seedFirstFreeActorBlockFromSpawnTypeTable(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b}`);
  console.log("  EQUAL/all-live: no free slot, RAM identical (no writes)");
});

test("EQUAL: first block free — seed pass 1", () => {
  const o = craft([], 0x01); // block 0 is zeroed -> free
  const c = craft([], 0x01);
  oracle(o);
  seedFirstFreeActorBlockFromSpawnTypeTable(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b}`);
  console.log(`  EQUAL/seed-1: seeded ${hx(blockBase(0))}, RAM identical`);
});

test("EQUAL: two live then free — step twice, seed pass 3", () => {
  const o = craft([0, 1], 0x03); // blocks 0,1 live; block 2 free
  const c = craft([0, 1], 0x03);
  oracle(o);
  seedFirstFreeActorBlockFromSpawnTypeTable(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b}`);
  console.log(`  EQUAL/seed-3: seeded ${hx(blockBase(2))}, RAM identical`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: all-live writes nothing; a free block stamps the kind field", () => {
  const live = craft([0], 0x01);
  const b0 = live.dumpState();
  oracle(live);
  assert.deepEqual([...live.dumpState()], [...b0], "an all-live scan must leave RAM untouched");

  const free = craft([], 0x01);
  oracle(free);
  assert.notEqual(free.mem.read8(blockBase(0) + KIND_FIELD), 0x00, "a free block must get its kind byte stamped");
  console.log("  WRITE-SET: all-live inert; free block stamps its kind");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong kind byte is CAUGHT by the RAM diff", () => {
  const o = craft([], 0x01);
  const c = craft([], 0x01);
  oracle(o);
  seedFirstFreeActorBlockFromSpawnTypeTable(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: the seed is memory-equivalent before tampering");
  c.mem.write8(blockBase(0) + KIND_FIELD, (o.mem.read8(blockBase(0) + KIND_FIELD) ^ 0xff) & 0xff); // BUG
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong kind byte");
  assert.equal(d.addr, blockBase(0) + KIND_FIELD, `teeth caught ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/kind: wrong kind caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong seeded field on pass 3 is CAUGHT by the RAM diff", () => {
  const o = craft([0, 1], 0x03);
  const c = craft([0, 1], 0x03);
  oracle(o);
  seedFirstFreeActorBlockFromSpawnTypeTable(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: pass-3 seed is memory-equivalent before tampering");
  c.mem.write8(blockBase(2) + 0x06, (o.mem.read8(blockBase(2) + 0x06) ^ 0xff) & 0xff); // BUG: seeded count field
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seeded field");
  assert.equal(d.addr, blockBase(2) + 0x06, `teeth caught ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/seed: wrong seeded field caught at ${hx(d.addr)}`);
});

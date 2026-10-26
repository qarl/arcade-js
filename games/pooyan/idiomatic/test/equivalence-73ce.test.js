// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for despawnEagleAndSeedHoldOnWaveEmpty (ROM 0x73ce) — eagle-record state 2 (retire).
 *
 * Zero-fills the whole 0x18-byte record based at IX, then decrements the live-record count
 * (WAVE_RECORD_COUNT). When that count reaches zero — the last record of the wave has retired —
 * it seeds the inter-wave hold countdown (WAVE_HOLD_TIMER) to 0x30. Crafted inputs: IX (a record
 * pre-filled so the clear is observable) and the record count.
 *
 * Contract compared: RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared, and
 * there is NO register live-out — this is a dispatch target; its exit registers are not consumed.
 *
 * All cases are CRAFTED: the record bytes, the count, and the hold cell are poked identically on
 * both sides, sp seated inside STACK_SCRATCH so the clear helper's rst-0x10 push/ret stay there.
 *
 * Jobs:
 *   1. EQUAL — over count>1 / count==1 (seed) / count==0 (wrap) paths, oracle == despawnEagleAndSeedHoldOnWaveEmpty in
 *      RAM (−stack).
 *   2. WRITE-SET — the count==1 path clears the 0x18 record cells, zeroes the count, and seeds 0x30.
 *   3. TEETH — a record cell left uncleared is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-73ce.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_73ce as oracle } from "../../translated/loc_73ce.js";
import { despawnEagleAndSeedHoldOnWaveEmpty } from "../despawnEagleAndSeedHoldOnWaveEmpty.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, WAVE_RECORD_COUNT, WAVE_HOLD_TIMER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ae0; // record base (work RAM, clear of STACK_SCRATCH and the wave cells)
const RECORD_LEN = 0x18;
const INTER_WAVE_HOLD = 0x30;
const DIRTY = 0xaa; // pre-fill so the clear is observable
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with a dirty record, the count, and a known (non-0x30) hold cell. */
function craft(count) {
  const m = BASE.clone();
  for (let i = 0; i < RECORD_LEN; i++) m.mem.write8(REC + i, DIRTY);
  m.mem.write8(WAVE_RECORD_COUNT, count & 0xff);
  m.mem.write8(WAVE_HOLD_TIMER, 0x00);
  m.regs.ix = REC;
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH; the oracle's rst-0x10 push/ret stay there
  return m;
}

const CASES = [
  { label: "count 3 -> 2, no seed", count: 0x03 },
  { label: "count 1 -> 0, seed hold 0x30", count: 0x01 },
  { label: "count 0 -> 0xff (wrap), no seed", count: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted count paths — despawnEagleAndSeedHoldOnWaveEmpty == oracle in RAM (−stack)", () => {
  for (const { label, count } of CASES) {
    const o = craft(count);
    const c = craft(count);
    oracle(o);
    despawnEagleAndSeedHoldOnWaveEmpty(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} ("${label}")`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted count paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: count==1 clears the record, zeroes the count, and seeds the hold", () => {
  const expected = new Set([WAVE_RECORD_COUNT, WAVE_HOLD_TIMER]);
  for (let i = 0; i < RECORD_LEN; i++) expected.add(REC + i);

  const before = craft(0x01);
  const after = craft(0x01);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Set();
  for (let off = 0; off < b0.length; off++) {
    const addr = after.stateOffsetToAddr(off);
    if (b0[off] !== a1[off] && !inDeadStack(addr)) changed.add(addr);
  }
  for (let i = 0; i < RECORD_LEN; i++) assert.equal(after.mem.read8(REC + i), 0x00, `record cell ${hx(REC + i)} must be cleared`);
  assert.equal(after.mem.read8(WAVE_RECORD_COUNT), 0x00, "record count must be zeroed");
  assert.equal(after.mem.read8(WAVE_HOLD_TIMER), INTER_WAVE_HOLD, "hold must be seeded to 0x30");
  assert.equal(changed.size, expected.size, `expected ${expected.size} writes, got ${changed.size}`);
  for (const addr of changed) assert.ok(expected.has(addr), `unexpected write at ${hx(addr)}`);
  console.log(`  WRITE-SET: 0x18 record cleared + count ${hx(WAVE_RECORD_COUNT)}=0 + hold ${hx(WAVE_HOLD_TIMER)}=0x30`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: an uncleared record cell is CAUGHT by the RAM diff", () => {
  const o = craft(0x03);
  const c = craft(0x03);
  oracle(o);
  despawnEagleAndSeedHoldOnWaveEmpty(c);
  c.mem.write8(REC + 0x00, 0x55); // BUG: this record cell must be cleared to 0
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an uncleared record cell — it is worthless");
  assert.equal(d.addr, REC + 0x00, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: uncleared record cell caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

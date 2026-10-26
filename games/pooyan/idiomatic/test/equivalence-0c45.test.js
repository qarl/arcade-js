// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for fetchWordFromTableIndex (ROM 0x0c45, Pooyan) — the little-endian word-table lookup.
 * A = index, HL = table base -> DE = table[index]; the doubled index is 8-bit so it wraps past 0x80.
 *
 * SEATING: BALANCED (plain ret). fetchWordFromTableIndex writes NO RAM, so equivalence is the DE register live-out
 * (the looked-up word) plus a RAM-untouched check (dumpState minus stack scratch below the entry SP). DE is the only
 * live-out: the oracle also leaves A = 2*index and HL = base+2*index+1, but every caller overwrites
 * or ex-de-hl-discards those before reading, so they are NOT compared (they legitimately diverge —
 * the module leaves them at their entry values). SP is parked in STACK_SCRATCH for the oracle's ret.
 *
 * A word table is crafted at 0x8e00; the oracle is the reference, so cases assert module DE ==
 * oracle DE rather than a precomputed word.
 *
 * Jobs:
 *   1. EQUAL — index in-range, index 0, index 0x7f (max no-wrap), index 0x80/0xff (8-bit wrap):
 *      module DE == oracle DE and RAM (−stack) identical.
 *   2. WRITE-SET — fetchWordFromTableIndex leaves RAM byte-identical (a pure read).
 *   3. TEETH — a low-byte-only word is rejected by the DE check; the module actually SETS DE (not
 *      the seeded sentinel); a corrupted RAM byte is caught by the diff harness.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0c45.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0c45 as oracle } from "../../translated/loc_0c45.js";
import { fetchWordFromTableIndex } from "../fetchWordFromTableIndex.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TABLE = 0x8e00; //     word-table base, 0x100 bytes of scratch work-RAM
const SENTINEL_DE = 0x5555; // a bridge that fails to set DE is caught
const SP0 = 0x8ff0; //       inside STACK_SCRATCH
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with a deterministic word table seated and the index/base/sentinel/SP registers set. */
function craft(index) {
  const m = BASE.clone();
  for (let o = 0; o < 0x100; o++) m.mem8[TABLE + o] = (o * 7 + 3) & 0xff;
  m.regs.a = index & 0xff;
  m.regs.hl = TABLE;
  m.regs.de = SENTINEL_DE;
  m.regs.sp = SP0;
  return m;
}

const CASES = [
  { name: "index 0x03 -> table[3]", index: 0x03 },
  { name: "index 0x00 -> table[0]", index: 0x00 },
  { name: "index 0x7f -> table[0x7f] (offset 0xfe, no wrap)", index: 0x7f },
  { name: "index 0x80 -> offset 0 (8-bit wrap)", index: 0x80 },
  { name: "index 0xff -> offset 0xfe (8-bit wrap)", index: 0xff },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: fetchWordFromTableIndex == oracle in DE + RAM (−stack)", () => {
  for (const { name, index } of CASES) {
    const o = craft(index);
    const c = craft(index);
    oracle(o);
    const ret = fetchWordFromTableIndex(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.de & 0xffff, o.regs.de & 0xffff, `${name}: DE live-out mismatch`);
    assert.equal(ret & 0xffff, o.regs.de & 0xffff, `${name}: returned word must match the oracle's DE`);
  }
  console.log(`  EQUAL: ${CASES.length} lookups identical (DE + RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: fetchWordFromTableIndex is a pure read — RAM is byte-identical after", () => {
  const c = craft(0x03);
  const b0 = c.dumpState();
  fetchWordFromTableIndex(c);
  assert.deepEqual([...c.dumpState()], [...b0], "a lookup must not write RAM");
  console.log("  WRITE-SET: RAM untouched");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a low-byte-only word is CAUGHT by the DE live-out check", () => {
  const o = craft(0x03);
  const c = craft(0x03);
  oracle(o);
  const ret = fetchWordFromTableIndex(c);
  assert.equal(ret & 0xffff, o.regs.de & 0xffff, "sanity: module DE matches the oracle");
  assert.notEqual((o.regs.de >> 8) & 0xff, 0x00, "teeth need a nonzero high byte to bite");
  const broken = ret & 0x00ff; // BUG: a lookup that drops the high byte
  assert.notEqual(broken, o.regs.de & 0xffff, "the DE check must reject a low-byte-only word");
  console.log(`  TEETH(DE): word ${hx(ret)} == oracle; ${hx(broken)} rejected`);
});

test("TEETH: the module actually SETS DE (not the seeded sentinel)", () => {
  const c = craft(0x03);
  const ret = fetchWordFromTableIndex(c);
  assert.notEqual(c.regs.de & 0xffff, SENTINEL_DE, "the module must overwrite the sentinel DE");
  assert.equal(ret & 0xffff, c.regs.de & 0xffff, "the return must equal the register it set");
  console.log(`  TEETH(sentinel): DE set to ${hx(ret)}, sentinel cleared`);
});

test("TEETH: a corrupted RAM byte is CAUGHT by the diff harness", () => {
  const o = craft(0x03);
  const c = craft(0x03);
  oracle(o);
  fetchWordFromTableIndex(c);
  c.mem8[TABLE + 0x40] ^= 0xff; // BUG: perturb a table byte after the read
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the RAM harness FAILED to catch a corrupted byte");
  assert.equal(d.addr, TABLE + 0x40, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

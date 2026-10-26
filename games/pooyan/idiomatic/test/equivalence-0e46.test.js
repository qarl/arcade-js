// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for clearBit2AcrossSixSlots (ROM 0x0E46) — clear bit 2 (mask 0xFB)
 * of the first byte in each of six stride-4 table entries at (HL): (HL), (HL+4), …
 * (HL+20).
 *
 * This is the capture / clone / replay memory-equivalence gate (docs/decompiler-pipeline). The
 * routine WRITES RAM, so every case uses a FRESH clone per side. 0x0E46 has NO static
 * caller and is NOT reached in a plain attract boot (verified: 0 dispatches over 6000
 * frames), so every case is a CRAFTED entry: a Machine is built, HL is pointed into the
 * work-RAM actor arena (0x8A80, clear of STACK_SCRATCH), the target span is pre-dirtied
 * IDENTICALLY on both sides, and the oracle and clearBit2AcrossSixSlots run on separate
 * clones. Cloning sets nextNmi=Infinity, so the oracle's m.step traffic fires no NMI.
 *
 * The contract is whole RAM (dumpState) minus stack scratch below the entry SP + the idiomatic side leaving
 * SP and pc unchanged (it models no ret; the oracle's only stack traffic is its terminal
 * pop, a register move, and it writes no stack bytes at all).
 *
 * Jobs:
 *   1. EQUAL (crafted, dense span) — pre-dirty HL..HL+23 to 0xFF on both sides; oracle
 *      vs idiomatic leave identical RAM (−stack); the idiomatic side leaves SP/pc
 *      unchanged. Positive check: the six stride bytes become 0xFB and the in-between
 *      bytes stay 0xFF — pinning both the stride (4) and that only bit 2 is cleared.
 *   2. WRITE-SET (crafted) — the oracle's ONLY writes are the six stride bytes.
 *   3. CLEAR-SEMANTICS (crafted) — a byte with bit 2 set loses only bit 2 (0x04->0x00,
 *      0xFF->0xFB, 0xFB stays 0xFB), proving the mask.
 *   4. TEETH — a twin that corrupts the first stride byte (writes 0xFF after the clear)
 *      MUST be caught, at HL.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0e46.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0e46 as oracle } from "../../translated/loc_0e46.js";
import { clearBit2AcrossSixSlots } from "../clearBit2AcrossSixSlots.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const BASE = 0x8a80; // HL: six stride-4 entries live at 0x8A80,0x8A84,…,0x8A94 (all work RAM)
const SLOTS = [0, 4, 8, 12, 16, 20].map((o) => BASE + o);
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Build a crafted base: HL=BASE, and paint the 24-byte span with `fill(m)`. */
function craftBase(fill) {
  const m = new Machine(ROM);
  m.regs.hl = BASE;
  fill(m);
  return m;
}

const dense = (m) => { for (let a = BASE; a < BASE + 24; a++) m.mem.write8(a, 0xff); };

// -- 1. EQUAL (crafted dense span) --------------------------------------------

test("EQUAL: crafted dense span — clearBit2AcrossSixSlots == oracle in RAM (−stack); pc & sp untouched", () => {
  const base = craftBase(dense);
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  clearBit2AcrossSixSlots(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);

  // The idiomatic routine models no stack/ret: SP and pc unchanged from entry.
  const b = base.clone();
  const sp0 = b.regs.sp, pc0 = b.pc;
  clearBit2AcrossSixSlots(b);
  assert.equal(b.regs.sp, sp0, "clearBit2AcrossSixSlots must leave SP unchanged (no stack modelling)");
  assert.equal(b.pc, pc0, "clearBit2AcrossSixSlots must leave pc unchanged (no ret modelling)");

  // Positive: the six stride bytes are cleared to 0xFB; the in-between bytes untouched (0xFF).
  for (const a of SLOTS) assert.equal(c.mem.read8(a), 0xfb, `stride byte ${hx(a)} must be 0xFB`);
  for (let a = BASE; a < BASE + 24; a++) {
    if (SLOTS.includes(a)) continue;
    assert.equal(c.mem.read8(a), 0xff, `in-between byte ${hx(a)} must be untouched (0xFF)`);
  }
  console.log("  EQUAL: dense span cleared -> six 0xFB stride bytes, in-between 0xFF, RAM identical");
});

// -- 2. WRITE-SET (crafted) ---------------------------------------------------

test("WRITE-SET: the oracle's only work-RAM writes are the six stride bytes", () => {
  const base = craftBase(dense);
  const before = base.clone();
  const after = base.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  }
  assert.deepEqual(changed.sort((x, y) => x - y), [...SLOTS].sort((x, y) => x - y),
    `oracle changed ${changed.map(hx).join(" ")}, expected the six stride bytes`);
  console.log(`  WRITE-SET: ${changed.length} bytes changed, exactly ${SLOTS.map(hx).join(" ")}`);
});

// -- 3. CLEAR-SEMANTICS (crafted mixed pattern) -------------------------------

test("CLEAR-SEMANTICS: only bit 2 is cleared (0x04->0x00, 0xFF->0xFB, 0xFB stays)", () => {
  // Give each stride byte a distinct value; the in-between bytes get a marker.
  const values = [0x04, 0xff, 0xfb, 0x00, 0x24, 0x7f];
  const expect = values.map((v) => v & 0xfb);
  const paint = (m) => {
    for (let a = BASE; a < BASE + 24; a++) m.mem.write8(a, 0x11); // marker
    SLOTS.forEach((a, i) => m.mem.write8(a, values[i]));
  };
  const base = craftBase(paint);
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  clearBit2AcrossSixSlots(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  SLOTS.forEach((a, i) => assert.equal(c.mem.read8(a), expect[i],
    `${hx(a)}: ${hx(values[i])} & 0xFB must be ${hx(expect[i])}, got ${hx(c.mem.read8(a))}`));
  console.log(`  CLEAR-SEMANTICS: ${values.map(hx).join(" ")} -> ${expect.map(hx).join(" ")}`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: does the correct clear, then corrupts the first stride byte. */
function brokenClearBit2AcrossSixSlots(m, base = m.regs.hl) {
  clearBit2AcrossSixSlots(m, base);
  m.mem.write8(base & 0xffff, 0xff); // BUG: first stride byte must be (its value & 0xFB)
}

test("TEETH: a corrupted first stride byte is CAUGHT, at HL", () => {
  const base = craftBase(dense);
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  brokenClearBit2AcrossSixSlots(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the corrupted stride byte — it is worthless");
  assert.equal(d.addr, BASE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: corrupted first stride byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

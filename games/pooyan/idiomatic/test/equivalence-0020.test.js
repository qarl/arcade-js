// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for fetchByteFromTableIndex (ROM 0x0020) — the rst 0x20 byte-table lookup:
 * HL := HL + A (16-bit), then A := (HL), leaving the advanced pointer behind.
 *
 * This is the cycle-free / memory-equivalence gate. The routine WRITES no memory (it only
 * reads a table byte), so the go-forward contract is RAM (dumpState, minus stack scratch below the entry SP,
 * trivially null) PLUS the declared register live-out:
 *
 *   - A  = the fetched byte table[base+index] — load-bearing: every rst 0x20 caller reads
 *          the byte back out of A (e.g. runSelfTestAndInitMachineState's coinage lookups).
 *   - HL = base+index, the advanced pointer — a genuine architectural result of the add,
 *          written faithfully so a register-dispatched caller reading HL gets the oracle's
 *          value. (No single HL consumer was individually verified; setting it can only
 *          match the oracle, never produce a false failure.)
 *
 * pc/SP/cycles are deliberately NOT compared. For a load-bearing live-out the test also
 * asserts the module SET the register on its own clone (c.regs.X === o.regs.X): a
 * return-only rewrite that never writes the register passes the return check but fails the
 * translated caller.
 *
 * Jobs:
 *   1. EQUAL — over crafted (base,index) pairs, module == oracle in RAM (−stack) and in A
 *      and HL, and the module SET both registers.
 *   2. WRITE-SET — the oracle changes ZERO memory cells (a pure read); documented.
 *   3. CRAFTED — a base+index that overflows 16 bits (wrap to a ROM address) is fetched
 *      identically on both sides.
 *   4. TEETH — a twin that fetches table[base] (index ignored) is caught by the A check;
 *      a twin that returns base (not base+index) is caught by the HL check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0020.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0020 as oracle } from "../../translated/loc_0020.js";
import { fetchByteFromTableIndex } from "../fetchByteFromTableIndex.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const u8 = (v) => v & 0xff;
const u16 = (v) => v & 0xffff;
const hx = (v) => "0x" + u16(v).toString(16);
const tableByte = (i) => u8(0xa0 + i); // deterministic seeded-table pattern

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with HL=base, A=index, and (for a RAM base) a deterministic table seeded. */
function craft(base, index, seedTable = true) {
  const m = BASE.clone();
  m.regs.hl = u16(base);
  m.regs.a = u8(index);
  m.regs.sp = 0x8ffe; // scratch; the oracle's ret only POPs (reads), never writes
  if (seedTable) {
    for (let i = 0; i <= 0x40; i++) m.mem.write8(u16(base + i), tableByte(i));
  }
  return m;
}

// RAM-table cases (seeded) + one 16-bit overflow case (wrap into ROM, not seeded).
const CASES = [
  { base: 0x8b00, index: 0x00 },
  { base: 0x8b00, index: 0x05 },
  { base: 0x8b00, index: 0x3f },
  { base: 0x8c00, index: 0x11 },
];
const WRAP = { base: 0xfff0, index: 0x20, seedTable: false }; // base+index = 0x10010 -> 0x0010 (ROM)

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted (base,index) — fetchByteFromTableIndex == oracle in RAM (−stack) + A + HL", () => {
  for (const { base, index } of CASES) {
    const o = craft(base, index);
    const c = craft(base, index);
    oracle(o);
    const ret = fetchByteFromTableIndex(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} (base=${hx(base)} index=${hx(index)})`);
    assert.equal(ret[0], o.regs.a, `A (fetched byte) mismatch base=${hx(base)} index=${hx(index)}`);
    assert.equal(ret[1], o.regs.hl, `HL (advanced pointer) mismatch base=${hx(base)} index=${hx(index)}`);
    // SIDE-EFFECT arms: the bridge must SET both registers on the module clone, not merely return them.
    assert.equal(c.regs.a, o.regs.a, `module must SET A for the register-dispatched caller (base=${hx(base)} index=${hx(index)})`);
    assert.equal(c.regs.hl, o.regs.hl, `module must SET HL (base=${hx(base)} index=${hx(index)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A + HL)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes ZERO memory cells (a pure table read)", () => {
  const { base, index } = CASES[0];
  const before = craft(base, index);
  const b0 = before.dumpState();
  const after = craft(base, index);
  oracle(after);
  const a1 = after.dumpState();

  let changed = 0;
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off] && !inDeadStack(after.stateOffsetToAddr(off))) changed++;
  }
  assert.equal(changed, 0, `expected 0 written cells, got ${changed}`);
  console.log("  WRITE-SET: 0 memory writes (read-only lookup)");
});

// -- 3. CRAFTED (16-bit overflow) ---------------------------------------------

test("CRAFTED: base+index overflowing 16 bits wraps identically (fetch a ROM byte)", () => {
  const o = craft(WRAP.base, WRAP.index, WRAP.seedTable);
  const c = craft(WRAP.base, WRAP.index, WRAP.seedTable);
  oracle(o);
  const ret = fetchByteFromTableIndex(c);

  assert.equal(ramDiffMinusStack(o, c), null, "RAM identical on the wrap path");
  assert.equal(o.regs.hl, u16(WRAP.base + WRAP.index), "oracle HL wrapped to the low address");
  assert.equal(ret[0], o.regs.a, "A matches on the wrap path");
  assert.equal(ret[1], o.regs.hl, "HL matches on the wrap path");
  assert.equal(c.regs.a, o.regs.a, "module SET A on the wrap path");
  assert.equal(c.regs.hl, o.regs.hl, "module SET HL on the wrap path");
  console.log(`  CRAFTED: ${hx(WRAP.base)}+${hx(WRAP.index)} -> HL=${hx(o.regs.hl)} A=${hx(o.regs.a)}`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: an index-ignoring fetch is CAUGHT by the A check", () => {
  const { base, index } = CASES[2]; // index 0x3f != 0 so table[base] != table[base+index]
  const o = craft(base, index);
  oracle(o);
  const wrongA = tableByte(0); // BUG: fetch table[base], ignoring the index
  assert.notEqual(wrongA, o.regs.a, "the A live-out check must reject an index-ignoring fetch");
  assert.equal(o.regs.a, tableByte(index), "sanity: oracle A is table[base+index]");
  console.log(`  TEETH/A: index-ignoring fetch ${hx(wrongA)} rejected (oracle A=${hx(o.regs.a)})`);
});

test("TEETH: an un-advanced HL (base, not base+index) is CAUGHT by the HL check", () => {
  const { base, index } = CASES[2];
  const o = craft(base, index);
  oracle(o);
  assert.notEqual(u16(base), o.regs.hl, "the HL live-out check must reject an un-advanced pointer");
  assert.equal(o.regs.hl, u16(base + index), "sanity: oracle HL is base+index");
  console.log(`  TEETH/HL: un-advanced ${hx(base)} rejected (oracle HL=${hx(o.regs.hl)})`);
});

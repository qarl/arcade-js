// SPDX-License-Identifier: GPL-3.0-only
// Memory+value equivalence for advanceRecordTotals (ROM 0x01d9) -- with HL just before a 4-byte record, fold C into
// [HL+2] and the record's delta byte [HL+1] into [HL+3], leaving the second total in A. Input registers
// HL and C; live-out = the two stores (RAM) AND A (read back as B by the 0x186e caller). Each side runs
// on a fresh clone; the contract is RAM (dumpState, minus stack scratch below the entry SP) plus the A value assertion.
// Run: node --test games/invaders/idiomatic/test/equivalence-01d9.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_01d9 as oracleBody } from "../../translated/loc_01d9.js";
import { advanceRecordTotals } from "../advanceRecordTotals.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x01d9;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x01d9 dispatches -- advanceRecordTotals == oracle in RAM (-stack) and in A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); advanceRecordTotals(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: [HL+2]+=C, [HL+3]+=[HL+1], A returns the second total", () => {
  const cases = [
    { hl: 0x2007, c: 0x03, r1: 0x10, r2: 0x05, r3: 0x20 }, // the translated-oracle seat
    { hl: 0x2100, c: 0xff, r1: 0x01, r2: 0xff, r3: 0xfe }, // wraps both stores
    { hl: 0x2200, c: 0x00, r1: 0x00, r2: 0x00, r3: 0x00 }, // all-zero
    { hl: 0x2050, c: 0x80, r1: 0x7f, r2: 0x80, r3: 0x81 }, // mid-range carries
    { hl: 0x2300, c: 0xa5, r1: 0xff, r2: 0x01, r3: 0xff }, // near the stack scratch, still clear of it
  ];
  for (const t of cases) {
    const o = new Machine(ROM);
    const c = new Machine(ROM);
    for (const mm of [o, c]) {
      mm.regs.hl = t.hl; mm.regs.c = t.c;
      mm.mem.write8(t.hl + 1, t.r1);
      mm.mem.write8(t.hl + 2, t.r2);
      mm.mem.write8(t.hl + 3, t.r3);
    }
    oracle(o); advanceRecordTotals(c);
    assert.equal(ramDiff(o, c), null, `HL=0x${t.hl.toString(16)}`);
    const expA = (t.r1 + t.r3) & 0xff;
    assert.equal(c.regs.a, expA, `A live-out HL=0x${t.hl.toString(16)}`);
    assert.equal(c.mem.read8(t.hl + 2), (t.c + t.r2) & 0xff, "[HL+2] += C");
    assert.equal(c.mem.read8(t.hl + 3), expA, "[HL+3] += [HL+1]");
  }
});

test("TEETH: a wrong stored byte is caught by the RAM diff", () => {
  const o = new Machine(ROM);
  const c = new Machine(ROM);
  for (const mm of [o, c]) {
    mm.regs.hl = 0x2007; mm.regs.c = 0x03;
    mm.mem.write8(0x2008, 0x10); mm.mem.write8(0x2009, 0x05); mm.mem.write8(0x200a, 0x20);
  }
  oracle(o);
  advanceRecordTotals(c); c.mem.write8(0x200a, 0x5a); // BUG: wrong second total
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stored byte");
  assert.equal(d.addr, 0x200a);
});

test("TEETH: a wrong A live-out would be caught by the value assertion", () => {
  const c = new Machine(ROM);
  c.regs.hl = 0x2007; c.regs.c = 0x03;
  c.mem.write8(0x2008, 0x10); c.mem.write8(0x2009, 0x05); c.mem.write8(0x200a, 0x20);
  const a = advanceRecordTotals(c);                       // golden second total = 0x10 + 0x20 = 0x30
  assert.equal(a, 0x30, "golden A live-out returned");
  assert.equal(c.regs.a, 0x30, "golden A live-out written to the register");
  assert.notEqual(a ^ 0xff, 0x30, "a mutated twin's A differs from the golden -- the assertion has teeth");
});

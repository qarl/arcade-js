// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for copyTemplateToRecord (ROM 0x075f) -- seat the source pointer at the ROM template SAUCER_RECORD_TEMPLATE, then
// block-copy B bytes into (HL) (blockCopy). Live-out is MEMORY only: the oracle's blockCopy advances
// HL/DE and zeroes B, but every caller of 0x075f overwrites those before reading (blockCopy's own
// contract), so the contract is RAM (dumpState, minus stack scratch below the entry SP). B and HL come from the caller.
// Run: node --test games/invaders/idiomatic/test/equivalence-075f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_075f as oracleBody } from "../../translated/loc_075f.js";
import { copyTemplateToRecord } from "../copyTemplateToRecord.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SAUCER_RECORD_TEMPLATE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x075f;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x075f dispatches -- copyTemplateToRecord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); copyTemplateToRecord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: B bytes copied from SAUCER_RECORD_TEMPLATE into (HL) for several counts", () => {
  const DST = 0x2100; // work RAM, non-overlapping with the ROM source
  for (const b of [1, 0x0a, 0x20]) {
    const o = new Machine(ROM); o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
    const c = new Machine(ROM); c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
    o.regs.hl = DST; o.regs.b = b;
    c.regs.hl = DST; c.regs.b = b;
    oracle(o); copyTemplateToRecord(c);
    assert.equal(ramDiff(o, c), null, `B=0x${b.toString(16)}`);
    for (let i = 0; i < b; i++) {
      assert.equal(c.mem.read8(DST + i), c.mem.read8(SAUCER_RECORD_TEMPLATE + i), `dst[${i}] B=0x${b.toString(16)}`);
    }
  }
});

test("TEETH: a broken twin (off-by-one copied value) is caught", () => {
  // Real-logic mutation: still copies from the template, but corrupts each byte.
  function loc_075f_broken(m, hl = m.regs.hl, b = m.regs.b) {
    const n = b === 0 ? 256 : b;
    for (let i = 0; i < n; i++) m.mem8[hl + i] = (m.mem8[SAUCER_RECORD_TEMPLATE + i] + 1) & 0xff; // BUG: value+1
  }
  const DST = 0x2100, b = 0x0a;
  const o = new Machine(ROM); o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
  const c = new Machine(ROM); c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
  o.regs.hl = DST; o.regs.b = b;
  c.regs.hl = DST; c.regs.b = b;
  oracle(o); loc_075f_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong copied byte");
  assert.equal(d.addr, DST & 0xffff);
});

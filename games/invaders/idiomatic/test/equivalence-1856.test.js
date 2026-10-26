// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for fetchNextDrawRecord -- fetch a 4-byte record through the BC cursor. The 0xff terminator
// leaves A=0xff, carry SET and BC/HL/DE parked; otherwise HL = word at (BC), DE = word at (BC+2),
// BC advances +4, A = the last byte, carry CLEAR. Writes NO memory, so RAM is a vacuous contract; the
// live-out is REGISTERS (HL/DE/BC/A, consumed by the draw loops in typeDrawScript/drawScoreAdvanceTable/finishAttractCycle) plus
// the CARRY the loops branch on (rc/jc). The oracle's ret perturbs SP/PC, so we compare only the
// data-register + carry outputs, not firstRegDiff (which would false-fail on SP).
// Run: node --test games/invaders/idiomatic/test/equivalence-1856.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1856 as oracleBody } from "../../translated/loc_1856.js";
import { fetchNextDrawRecord } from "../fetchNextDrawRecord.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1856;

// The live-out registers this routine produces (data only -- SP/PC excluded) plus the carry flag.
const OUT = ["hl", "de", "bc", "a"];
const regOutDiff = (o, c) => {
  for (const k of OUT) if (o.regs[k] !== c.regs[k]) return { reg: k, o: o.regs[k], c: c.regs[k] };
  if (o.regs.fC !== c.regs.fC) return { reg: "fC", o: o.regs.fC, c: c.regs.fC };
  return null;
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1856 dispatches -- fetchNextDrawRecord == oracle in RAM + live-out registers + carry", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); fetchNextDrawRecord(c);
    assert.equal(ramDiff(o, c), null);    // neither side touches RAM
    assert.equal(regOutDiff(o, c), null); // the real contract: HL/DE/BC/A + carry
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Write a 4-byte record at BC in BOTH machines, run oracle vs module, assert the register image.
function seedRecord(m, addr, bytes) {
  for (let i = 0; i < bytes.length; i++) m.mem.write8(addr + i, bytes[i]);
}

test("CRAFTED: normal record unpacks into HL/DE, advances BC +4, A=last, carry clear", () => {
  const AT = 0x2100;
  for (const bytes of [
    [0x11, 0x22, 0x33, 0x44],
    [0x01, 0x00, 0xff, 0x7f],
    [0xa5, 0x5a, 0xc3, 0x3c],
    [0xfe, 0x00, 0x00, 0x00], // first byte 0xfe, NOT the 0xff terminator
  ]) {
    const o = new Machine(ROM); const c = new Machine(ROM);
    seedRecord(o, AT, bytes); seedRecord(c, AT, bytes);
    // seat distinct sentinels so an "unchanged" register is provably left alone
    o.regs.hl = c.regs.hl = 0xdead;
    o.regs.de = c.regs.de = 0xbeef;
    o.regs.bc = c.regs.bc = AT;
    o.regs.sp = c.regs.sp = 0x2400; // the oracle's ret reads [sp]; keep it mapped
    oracle(o); fetchNextDrawRecord(c);
    const tag = `bytes=${bytes}`;
    assert.equal(regOutDiff(o, c), null, tag);
    const [l, h, e, d] = bytes;
    assert.equal(c.regs.hl, ((h << 8) | l) & 0xffff, `HL ${tag}`);
    assert.equal(c.regs.de, ((d << 8) | e) & 0xffff, `DE ${tag}`);
    assert.equal(c.regs.bc, (AT + 4) & 0xffff, `BC ${tag}`);
    assert.equal(c.regs.a, d, `A ${tag}`);
    assert.equal(c.regs.fC, false, `carry clear ${tag}`);
  }
});

test("CRAFTED: 0xff terminator sets A=0xff, carry set, BC/HL/DE parked", () => {
  const AT = 0x2100;
  const o = new Machine(ROM); const c = new Machine(ROM);
  seedRecord(o, AT, [0xff, 0x99, 0x99, 0x99]); seedRecord(c, AT, [0xff, 0x99, 0x99, 0x99]);
  o.regs.hl = c.regs.hl = 0xdead;
  o.regs.de = c.regs.de = 0xbeef;
  o.regs.bc = c.regs.bc = AT;
  o.regs.sp = c.regs.sp = 0x2400;
  oracle(o); fetchNextDrawRecord(c);
  assert.equal(regOutDiff(o, c), null);
  assert.equal(c.regs.a, 0xff, "A = terminator byte");
  assert.equal(c.regs.fC, true, "carry set on terminator");
  assert.equal(c.regs.bc, AT, "BC parked at the terminator");
  assert.equal(c.regs.hl, 0xdead, "HL untouched");
  assert.equal(c.regs.de, 0xbeef, "DE untouched");
});

test("TEETH: a broken twin (packs HL big-endian) is caught by the register contract", () => {
  function loc_1856_broken(m, bc = m.regs.bc) {
    const first = m.mem8[bc];
    if (first === 0xff) return [(m.regs.a = first), (m.regs.fC = true)];
    const h = m.mem8[(bc + 1) & 0xffff];
    const e = m.mem8[(bc + 2) & 0xffff];
    const d = m.mem8[(bc + 3) & 0xffff];
    return [
      (m.regs.hl = (first << 8) | h), // BUG: big-endian pack, should be (h<<8)|first
      (m.regs.de = (d << 8) | e),
      (m.regs.bc = (bc + 4) & 0xffff),
      (m.regs.a = d),
      (m.regs.fC = false),
    ];
  }
  const AT = 0x2100, bytes = [0x11, 0x22, 0x33, 0x44];
  const o = new Machine(ROM); const c = new Machine(ROM);
  seedRecord(o, AT, bytes); seedRecord(c, AT, bytes);
  o.regs.bc = c.regs.bc = AT;
  o.regs.sp = c.regs.sp = 0x2400;
  oracle(o); loc_1856_broken(c);
  const d = regOutDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a big-endian HL pack");
  assert.equal(d.reg, "hl");
});

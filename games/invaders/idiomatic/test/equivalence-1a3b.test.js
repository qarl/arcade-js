// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for loadSpriteDescriptor (ROM 0x1a3b) -- read a 5-byte descriptor at (HL) into DE, A, C, B, then
// repoint HL at C:A. Writes NO memory, so RAM is a vacuous contract; the live-out is REGISTERS
// (DE/A/C/B/HL, consumed by loc_1a47/eraseShiftedSprite/drawSpriteWithCollision). The oracle's ret perturbs SP/PC, so we
// compare only the data-register outputs, not firstRegDiff (which would false-fail on SP).
// Run: node --test games/invaders/idiomatic/test/equivalence-1a3b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a3b as oracleBody } from "../../translated/loc_1a3b.js";
import { loadSpriteDescriptor } from "../loadSpriteDescriptor.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1a3b;

// The live-out registers this routine produces (data only -- SP/PC excluded).
const OUT = ["hl", "de", "a", "b", "c"];
const regOutDiff = (o, c) => {
  for (const k of OUT) if (o.regs[k] !== c.regs[k]) return { reg: k, o: o.regs[k], c: c.regs[k] };
  return null;
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1a3b dispatches -- loadSpriteDescriptor == oracle in RAM + live-out registers", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loadSpriteDescriptor(c);
    assert.equal(ramDiff(o, c), null);          // neither side touches RAM
    assert.equal(regOutDiff(o, c), null);       // the real contract: DE/A/C/B/HL
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Write a 5-byte descriptor at HL in BOTH machines, run oracle vs module, assert the register image.
function seedDescriptor(m, addr, bytes) {
  for (let i = 0; i < bytes.length; i++) m.mem.write8(addr + i, bytes[i]);
}

test("CRAFTED: descriptor at (HL) -> DE/A/C/B and HL=C:A for several inputs", () => {
  const AT = 0x2100;
  for (const bytes of [
    [0x00, 0x00, 0x00, 0x00, 0x00],
    [0x11, 0x22, 0x33, 0x44, 0x55],
    [0xff, 0x7f, 0x80, 0x01, 0xfe],
    [0xa5, 0x5a, 0xc3, 0x3c, 0x99],
  ]) {
    const o = new Machine(ROM); const c = new Machine(ROM);
    seedDescriptor(o, AT, bytes); seedDescriptor(c, AT, bytes);
    o.regs.hl = AT; c.regs.hl = AT;
    oracle(o); loadSpriteDescriptor(c);
    assert.equal(regOutDiff(o, c), null, `bytes=${bytes}`);
    // The expected register image, computed from the descriptor bytes [e,d,a,c,b].
    const [e, d, a, cc, b] = bytes;
    assert.equal(c.regs.e, e, "E"); assert.equal(c.regs.d, d, "D");
    assert.equal(c.regs.a, a, "A"); assert.equal(c.regs.c, cc, "C");
    assert.equal(c.regs.b, b, "B");
    assert.equal(c.regs.hl, ((cc << 8) | a) & 0xffff, "HL=C:A");
  }
});

test("TEETH: a broken twin (wrong HL pack) is caught by the register contract", () => {
  function loc_1a3b_broken(m, hl = m.regs.hl) {
    const e = m.mem8[hl];
    const d = m.mem8[hl + 1];
    const a = m.mem8[hl + 2];
    const c = m.mem8[hl + 3];
    const b = m.mem8[hl + 4];
    return [m.regs.hl = (a << 8) | c, m.regs.de = (d << 8) | e, m.regs.a = a, m.regs.b = b, m.regs.c = c]; // BUG: A:C not C:A
  }
  const AT = 0x2100, bytes = [0x11, 0x22, 0x33, 0x44, 0x55];
  const o = new Machine(ROM); const c = new Machine(ROM);
  seedDescriptor(o, AT, bytes); seedDescriptor(c, AT, bytes);
  o.regs.hl = AT; c.regs.hl = AT;
  oracle(o); loc_1a3b_broken(c);
  const d = regOutDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong HL pack");
  assert.equal(d.reg, "hl");
});

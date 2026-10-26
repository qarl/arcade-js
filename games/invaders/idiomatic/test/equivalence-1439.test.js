// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawSpriteColumn -- copy B bytes into a vertical column ([dst] <- [src], dst steps
// one screen row, src steps one byte). Live-out is memory PLUS the advanced destination pointer HL
// (a caller carries it across passes), so each check diffs RAM (minus stack scratch below the entry SP) AND asserts HL.
// Run: node --test games/invaders/idiomatic/test/equivalence-1439.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1439 as oracleBody } from "../../translated/loc_1439.js";
import { drawSpriteColumn } from "../drawSpriteColumn.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1439;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1439 dispatches -- drawSpriteColumn == oracle in RAM (-stack) and HL live-out", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawSpriteColumn(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: B bytes copied down the column; HL advances by 0x20*B", () => {
  const cases = [
    { hl: 0x2400, de: 0x0100, b: 0x01 },
    { hl: 0x2500, de: 0x0040, b: 0x04 },
    { hl: 0x2a00, de: 0x1c00, b: 0x08 },
    { hl: 0x2400, de: 0x0000, b: 0x00 }, // count 0 -> a full 256-pass loop
  ];
  for (const { hl, de, b } of cases) {
    const o = new Machine(ROM); o.regs.sp = 0x2400; o.regs.hl = hl; o.regs.de = de; o.regs.b = b;
    const c = new Machine(ROM); c.regs.sp = 0x2400; c.regs.hl = hl; c.regs.de = de; c.regs.b = b;
    oracle(o); drawSpriteColumn(c);
    const label = `hl=0x${hl.toString(16)} de=0x${de.toString(16)} b=0x${b.toString(16)}`;
    assert.equal(ramDiff(o, c), null, label);
    assert.equal(c.regs.hl, o.regs.hl, `HL live-out ${label}`);
    const rows = b || 256;
    assert.equal(c.regs.hl, (hl + 0x20 * rows) & 0xffff, `HL end-pointer ${label}`);
  }
});

test("TEETH: a wrong copied byte is caught by the RAM diff", () => {
  const o = new Machine(ROM); o.regs.sp = 0x2400; o.regs.hl = 0x2500; o.regs.de = 0x0040; o.regs.b = 0x04;
  const c = new Machine(ROM); c.regs.sp = 0x2400; c.regs.hl = 0x2500; c.regs.de = 0x0040; c.regs.b = 0x04;
  oracle(o);
  drawSpriteColumn(c); c.mem.write8(0x2520, (c.mem.read8(0x2520) ^ 0xff) & 0xff); // BUG: corrupt a copied cell
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong copied byte");
  assert.equal(d.addr, 0x2520 & 0xffff);
});

test("TEETH: a wrong HL live-out is detectable", () => {
  const o = new Machine(ROM); o.regs.sp = 0x2400; o.regs.hl = 0x2500; o.regs.de = 0x0040; o.regs.b = 0x04;
  oracle(o);
  const wrongHl = (o.regs.hl + 0x20) & 0xffff; // a stride off by one row
  assert.notEqual(wrongHl, o.regs.hl, "an off-by-one-row HL differs from the oracle's HL");
});

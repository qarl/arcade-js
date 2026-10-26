// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for captureScreenRect -- block-copy a rectangle: for B rows copy C bytes from [HL] to a
// contiguous [DE] stream, dropping the source base one screen row between rows. Live-out is memory
// PLUS the two carried pointers DE (stream end) and HL (advanced source base) -- the sole caller
// threads both across passes -- so each check diffs RAM (minus stack scratch below the entry SP) AND asserts DE and HL.
// Run: node --test games/invaders/idiomatic/test/equivalence-147c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_147c as oracleBody } from "../../translated/loc_147c.js";
import { captureScreenRect } from "../captureScreenRect.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x147c;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x147c dispatches -- captureScreenRect == oracle in RAM (-stack) and DE/HL live-out", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); captureScreenRect(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.de, o.regs.de, "DE live-out matches the oracle");
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: B*C bytes copied into the stream; DE and HL advance", () => {
  const cases = [
    { hl: 0x0100, de: 0x2400, b: 0x03, c: 0x04 },
    { hl: 0x0200, de: 0x2600, b: 0x02, c: 0x08 },
    { hl: 0x1c00, de: 0x2a00, b: 0x05, c: 0x02 },
    { hl: 0x0000, de: 0x2000, b: 0x01, c: 0x00 }, // inner count 0 -> a 256-wide row
    { hl: 0x0000, de: 0x2400, b: 0x00, c: 0x01 }, // outer count 0 -> 256 rows
  ];
  for (const { hl, de, b, c } of cases) {
    const o = new Machine(ROM);
    o.regs.sp = 0x2400; o.regs.hl = hl; o.regs.de = de; o.regs.b = b; o.regs.c = c;
    const cc = new Machine(ROM);
    cc.regs.sp = 0x2400; cc.regs.hl = hl; cc.regs.de = de; cc.regs.b = b; cc.regs.c = c;
    oracle(o); captureScreenRect(cc);
    const rows = b || 256, cols = c || 256;
    const label = `hl=0x${hl.toString(16)} de=0x${de.toString(16)} b=0x${b.toString(16)} c=0x${c.toString(16)}`;
    assert.equal(ramDiff(o, cc), null, label);
    assert.equal(cc.regs.de, o.regs.de, `DE live-out ${label}`);
    assert.equal(cc.regs.hl, o.regs.hl, `HL live-out ${label}`);
    assert.equal(cc.regs.de, (de + rows * cols) & 0xffff, `DE end-pointer ${label}`);
    assert.equal(cc.regs.hl, (hl + 0x20 * rows) & 0xffff, `HL source base ${label}`);
  }
});

test("TEETH: a wrong copied byte is caught by the RAM diff", () => {
  const seed = { sp: 0x2400, hl: 0x0200, de: 0x2600, b: 0x02, c: 0x08 };
  const o = new Machine(ROM); Object.assign(o.regs, seed);
  const cc = new Machine(ROM); Object.assign(cc.regs, seed);
  oracle(o);
  captureScreenRect(cc); cc.mem.write8(0x2603, (cc.mem.read8(0x2603) ^ 0xff) & 0xff); // BUG: corrupt a copied cell
  const d = ramDiff(o, cc);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong copied byte");
  assert.equal(d.addr, 0x2603 & 0xffff);
});

test("TEETH: a wrong DE/HL live-out is detectable", () => {
  const o = new Machine(ROM);
  Object.assign(o.regs, { sp: 0x2400, hl: 0x0200, de: 0x2600, b: 0x02, c: 0x08 });
  oracle(o);
  assert.notEqual((o.regs.de + 1) & 0xffff, o.regs.de, "an off-by-one DE differs from the oracle's DE");
  assert.notEqual((o.regs.hl + 0x20) & 0xffff, o.regs.hl, "an off-by-one-row HL differs from the oracle's HL");
});

// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for eraseShiftedSprite -- erase B sprite rows: seat the shift offset (dissolved 0x1474 ->
// seatBlitPosition), then per row AND the complement of the hardware-shifted source byte into two
// adjacent screen columns (via ports 0x04 out / 0x03 in), stepping DE +1 and HL +0x20 each row.
// Live-out is memory (the cleared screen bytes) PLUS the advanced pointers HL, DE and the final A.
// The oracle push/pops around its internal setup + per-row save, so the RAM diff excludes the dead
// stack scratch below the entry SP. Run: node --test games/invaders/idiomatic/test/equivalence-1452.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1452 as oracleBody } from "../../translated/loc_1452.js";
import { eraseShiftedSprite } from "../eraseShiftedSprite.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1452;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1452 dispatches -- eraseShiftedSprite == oracle in RAM (-stack) and HL/DE/A", () => {
  for (const cap of CAPS) {
    // The oracle's setup push (0x1455) + per-row save residue sits just below the ENTRY SP; exclude
    // relative to that SP. The module drops the save/restore entirely.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); eraseShiftedSprite(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.regs.de, o.regs.de, "DE live-out matches the oracle");
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: shifted source bits cleared from two columns; HL +0x20*B, DE +B", () => {
  const cases = [
    { hl: 0x2000, de: 0x2100, b: 0x01 }, // L=0 -> shift 0
    { hl: 0x2003, de: 0x2110, b: 0x04 }, // L=3 -> shift 3
    { hl: 0x2805, de: 0x2120, b: 0x08 }, // L=5 -> shift 5
    { hl: 0x3007, de: 0x2130, b: 0x10 }, // L=7 -> shift 7
  ];
  const SPRITE = [0xaa, 0x3c, 0xff, 0x81, 0x18, 0x7e, 0x24, 0x99,
                  0xc3, 0x5a, 0x0f, 0xf0, 0x33, 0xcc, 0x66, 0x55];
  const seed = (m, hl, de, b) => {
    m.regs.sp = 0x2400; m.regs.hl = hl; m.regs.de = de; m.regs.b = b;
    for (let i = 0; i < b; i++) m.mem.write8((de + i) & 0xffff, SPRITE[i % SPRITE.length]);
    for (let a = 0x2400; a < 0x3000; a++) m.mem.write8(a, 0xff); // background to erase from
  };
  for (const { hl, de, b } of cases) {
    const o = new Machine(ROM); seed(o, hl, de, b);
    const c = new Machine(ROM); seed(c, hl, de, b);
    oracle(o); eraseShiftedSprite(c);
    const label = `hl=0x${hl.toString(16)} de=0x${de.toString(16)} b=0x${b.toString(16)}`;
    assert.equal(ramDiff(o, c), null, label);
    assert.equal(c.regs.hl, o.regs.hl, `HL live-out ${label}`);
    assert.equal(c.regs.de, o.regs.de, `DE live-out ${label}`);
    assert.equal(c.regs.a, o.regs.a, `A live-out ${label}`);
    assert.equal(c.regs.de, (de + b) & 0xffff, `DE advanced by B: ${label}`);
  }
});

test("TEETH: a module-mutating twin (drops the complement) diverges in the erased screen", () => {
  // Broken twin of eraseShiftedSprite that ANDs the RAW shifted byte instead of its complement -- so it fails
  // to clear the sprite's bits. Mutates the real logic, not a post-hoc overwrite.
  function loc_1452_broken(m, de = m.regs.de, b = m.regs.b) {
    const rows = b || 256;
    let dst = seatBlit(m);
    let src = de, a = 0;
    for (let r = 0; r < rows; r++) {
      const rowStart = dst;
      m.io.portOut(0x04, m.mem8[src]);
      a = m.io.portIn(0x03) & m.mem8[dst]; // BUG: missing ^ 0xff complement
      m.mem8[dst] = a;
      dst = (dst + 1) & 0xffff; src = (src + 1) & 0xffff;
      m.io.portOut(0x04, 0);
      a = m.io.portIn(0x03) & m.mem8[dst]; // BUG: missing ^ 0xff complement
      m.mem8[dst] = a;
      dst = (rowStart + 0x20) & 0xffff;
    }
    return [m.regs.hl = dst, m.regs.de = src, m.regs.a = a];
  }
  function seatBlit(m) { // inline seatBlitPosition so the mutant is self-contained
    m.io.portOut(0x02, m.regs.l & 0x07);
    const shifted = m.regs.hl >> 3;
    return (m.regs.hl = ((((shifted >> 8) & 0x3f) | 0x20) << 8) | (shifted & 0xff));
  }
  const seed = (m) => {
    m.regs.sp = 0x2400; m.regs.hl = 0x2003; m.regs.de = 0x2100; m.regs.b = 0x04;
    for (let i = 0; i < 4; i++) m.mem.write8(0x2100 + i, [0xaa, 0x3c, 0xff, 0x81][i]);
    for (let a = 0x2400; a < 0x3000; a++) m.mem.write8(a, 0xff);
  };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); loc_1452_broken(c);
  assert.notEqual(ramDiff(o, c), null, "the gate FAILED to catch a dropped complement");
});

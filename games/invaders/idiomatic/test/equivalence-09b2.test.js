// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawBcdByte -- draw the byte in A as two decimal (BCD) glyphs, high nibble then low, each
// plotted through drawDigit (its m.call DISSOLVED into a direct call). Inputs A (the byte), HL (screen
// address). Live-out: the plotted glyph cells (RAM) plus HL (advanced one glyph-column pair) and DE
// (preserved). The oracle push/pops DE and PSW, so its transient stack residue sits below the entry SP
// and is excluded from the RAM diff. A at exit is DEAD (every caller overwrites it or tail-returns), so
// it is not compared. Each side runs on a fresh clone with interrupts disabled.
// Run: node --test games/invaders/idiomatic/test/equivalence-09b2.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_09b2 as oracleBody } from "../../translated/loc_09b2.js";
import { drawBcdByte } from "../drawBcdByte.js";
import { drawDigit } from "../drawDigit.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x09b2;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x09b2 dispatches -- drawBcdByte == oracle in RAM (-stack), HL and DE", () => {
  for (const cap of CAPS) {
    // The oracle's push d / push psw / per-call return-addr residue sits just below the ENTRY SP;
    // exclude relative to that SP. The module keeps no machine stack.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    const de = cap.regs.de;
    oracle(o); drawBcdByte(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.regs.de, o.regs.de, "DE preserved, matches the oracle");
    assert.equal(c.regs.de, de, "DE unchanged from entry");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: two glyphs plotted (high nibble then low), HL advances 0x200, DE preserved", () => {
  for (const byte of [0x3c, 0x00, 0xff, 0xa5, 0x10]) {
    const seed = (m) => { m.regs.sp = 0x2400; m.regs.a = byte; m.regs.de = 0xbeef; m.regs.hl = 0x2400; };
    const o = new Machine(ROM); seed(o); o.io.setInte(false);
    const c = new Machine(ROM); seed(c); c.io.setInte(false);
    oracle(o); drawBcdByte(c);
    const tag = `A=0x${byte.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
    assert.equal(c.regs.hl, 0x2600, `HL advanced two glyph columns: ${tag}`);
    assert.equal(c.regs.de, 0xbeef, `DE preserved: ${tag}`);
    assert.equal(c.regs.de, o.regs.de, `DE matches oracle: ${tag}`);
    let drew = 0; // prove the plot is non-vacuous: the high-nibble glyph left set pixels
    for (let i = 0; i < 8; i++) drew |= c.mem.read8(0x2400 + i * 0x20);
    assert.notEqual(drew, 0, `first glyph plotted: ${tag}`);
  }
});

test("TEETH: a module-mutating twin (nibbles drawn in the wrong order) diverges in RAM", () => {
  // Broken twin of drawBcdByte: plots the LOW nibble first, then the high -- the two glyphs land swapped.
  const loc_09b2_broken = (m, a = m.regs.a) => {
    drawDigit(m, a & 0x0f);
    return drawDigit(m, (a >> 4) & 0x0f);
  };
  const seed = (m) => { m.regs.sp = 0x2400; m.regs.a = 0x3c; m.regs.de = 0xbeef; m.regs.hl = 0x2400; };
  const o = new Machine(ROM); seed(o); o.io.setInte(false);
  const c = new Machine(ROM); seed(c); c.io.setInte(false);
  oracle(o); loc_09b2_broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch swapped nibble glyphs");
});

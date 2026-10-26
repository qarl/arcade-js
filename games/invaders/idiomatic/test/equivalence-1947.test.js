// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawCreditCount -- read the BCD credit tally, seat its screen slot, then draw the byte
// as two decimal glyphs (its tail m.call DISSOLVED into a direct drawBcdByte). Input: the credit cell
// (RAM); the glyph slot is fixed. Live-out: the plotted glyph cells (RAM) plus HL (past both glyphs) and
// DE (preserved). The oracle tail-delegates through a push/pop chain, so its transient stack residue sits
// below the entry SP and is excluded from the RAM diff. Each side runs on a fresh clone, interrupts off.
// Run: node --test games/invaders/idiomatic/test/equivalence-1947.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1947 as oracleBody } from "../../translated/loc_1947.js";
import { drawCreditCount } from "../drawCreditCount.js";
import { drawBcdByte } from "../drawBcdByte.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { CREDIT_COUNT, CREDIT_COUNT_SCREEN_ADDR } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1947;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1947 dispatches -- drawCreditCount == oracle in RAM (-stack), HL and DE", () => {
  for (const cap of CAPS) {
    // The oracle's tail loc_09b2 push d / push psw / per-call return-addr residue sits just below the
    // ENTRY SP; exclude relative to that SP. The module keeps no machine stack.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    const de = cap.regs.de;
    oracle(o); drawCreditCount(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.regs.de, o.regs.de, "DE preserved, matches the oracle");
    assert.equal(c.regs.de, de, "DE unchanged from entry");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the credit cell draws as two glyphs at its slot; HL advances 0x200, DE preserved", () => {
  for (const credit of [0x00, 0x37, 0x99, 0x5a, 0x10]) {
    const seed = (m) => { m.regs.sp = 0x2400; m.regs.de = 0xbeef; m.mem.write8(CREDIT_COUNT, credit); };
    const o = new Machine(ROM); seed(o); o.io.setInte(false);
    const c = new Machine(ROM); seed(c); c.io.setInte(false);
    oracle(o); drawCreditCount(c);
    const tag = `credit=0x${credit.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
    assert.equal(c.regs.hl, (CREDIT_COUNT_SCREEN_ADDR + 0x200) & 0xffff, `HL advanced two glyph columns: ${tag}`);
    assert.equal(c.regs.de, 0xbeef, `DE preserved: ${tag}`);
    assert.equal(c.regs.de, o.regs.de, `DE matches oracle: ${tag}`);
  }
  // prove the plot is non-vacuous: a nonzero credit leaves set pixels in the first glyph column
  const c = new Machine(ROM); c.regs.sp = 0x2400; c.mem.write8(CREDIT_COUNT, 0x37); c.io.setInte(false);
  drawCreditCount(c);
  let drew = 0;
  for (let i = 0; i < 8; i++) drew |= c.mem.read8(CREDIT_COUNT_SCREEN_ADDR + i * 0x20);
  assert.notEqual(drew, 0, "first glyph plotted");
});

test("TEETH: a module-mutating twin (wrong glyph slot) diverges in RAM", () => {
  // Broken twin of drawCreditCount: seats the glyph base one page too low, so the digits land off their slot.
  const loc_1947_broken = (m) =>
    (m.regs.hl = (CREDIT_COUNT_SCREEN_ADDR + 0x100) & 0xffff, drawBcdByte(m, m.mem8[CREDIT_COUNT])); // BUG: not CREDIT_COUNT_SCREEN_ADDR
  const seed = (m) => {
    m.regs.sp = 0x2400; m.mem.write8(CREDIT_COUNT, 0x37);
    for (let a = CREDIT_COUNT_SCREEN_ADDR; a < CREDIT_COUNT_SCREEN_ADDR + 0x200; a++) m.mem.write8(a, 0xaa);
  };
  const o = new Machine(ROM); seed(o); o.io.setInte(false);
  const c = new Machine(ROM); seed(c); c.io.setInte(false);
  oracle(o); loc_1947_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the wrong glyph slot");
  assert.equal(d.addr, CREDIT_COUNT_SCREEN_ADDR & 0xffff, "first divergence is the real glyph slot");
});

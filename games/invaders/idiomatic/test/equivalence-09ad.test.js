// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawBcdWord -- draw the 16-bit value in DE as four BCD glyphs: the high byte (D) then
// the low byte (E), each plotted via drawBcdByte (which itself draws two decimal glyphs). Both m.call(0x09b2)
// (the D draw and the E tail-jump) are DISSOLVED into direct drawBcdByte calls. Inputs D, E, HL (screen
// address). Live-out: the plotted glyph cells (RAM) PLUS HL (advanced two glyph-pairs = 0x400) and DE
// (preserved). A at exit is DEAD (every caller overwrites it or tail-returns), so it is not compared. The
// oracle push/pops DE and PSW inside drawBcdByte, so its transient stack residue sits below the entry SP.
// Run: node --test games/invaders/idiomatic/test/equivalence-09ad.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_09ad as oracleBody } from "../../translated/loc_09ad.js";
import { drawBcdWord } from "../drawBcdWord.js";
import { drawBcdByte } from "../drawBcdByte.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x09ad;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x09ad dispatches -- drawBcdWord == oracle in RAM (-stack), HL and DE", () => {
  for (const cap of CAPS) {
    // The oracle's per-call return-addr / push d / push psw residue sits just below the ENTRY SP; exclude
    // relative to that SP. The module keeps no machine stack.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x20 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawBcdWord(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.regs.de, o.regs.de, "DE preserved, matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: four glyphs plotted (D high byte then E low byte); HL advances 0x400, DE preserved", () => {
  for (const [d, e] of [[0x12, 0x34], [0x00, 0x99], [0xab, 0xcd], [0xff, 0x00]]) {
    const seed = (m) => { m.regs.sp = 0x2400; m.regs.d = d; m.regs.e = e; m.regs.hl = 0x2400; };
    const o = new Machine(ROM); seed(o); o.io.setInte(false);
    const c = new Machine(ROM); seed(c); c.io.setInte(false);
    oracle(o); drawBcdWord(c);
    const tag = `DE=0x${d.toString(16)}${e.toString(16).padStart(2, "0")}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
    assert.equal(c.regs.hl, 0x2800, `HL advanced four glyph columns: ${tag}`);
    assert.equal(c.regs.de, (d << 8) | e, `DE preserved: ${tag}`);
    assert.equal(c.regs.de, o.regs.de, `DE matches oracle: ${tag}`);
    let drew = 0; // prove non-vacuous: the first glyph left set pixels
    for (let i = 0; i < 8; i++) drew |= c.mem.read8(0x2400 + i * 0x20);
    assert.notEqual(drew, 0, `first glyph plotted: ${tag}`);
  }
});

test("TEETH: a module-mutating twin (low byte drawn before high) diverges in RAM", () => {
  // Broken twin of drawBcdWord: draws E first then D -- the two byte-pairs land swapped on screen.
  const loc_09ad_broken = (m, d = m.regs.d, e = m.regs.e) => {
    drawBcdByte(m, e);
    return drawBcdByte(m, d);
  };
  const seed = (m) => { m.regs.sp = 0x2400; m.regs.d = 0x12; m.regs.e = 0x34; m.regs.hl = 0x2400; };
  const o = new Machine(ROM); seed(o); o.io.setInte(false);
  const c = new Machine(ROM); seed(c); c.io.setInte(false);
  oracle(o); loc_09ad_broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch swapped byte-pair glyphs");
});

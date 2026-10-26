// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawLivesDigit -- seat the glyph screen base 0x2501, mask A to its low nibble, then
// tail-jump into the decimal-glyph plotter (DISSOLVED drawDigit -> drawDigit). drawDigit reads HL from m.regs, so
// the seat rides the outgoing return-write. The only live-out is RAM (the glyph pixels): HL/A are dead in
// every caller (awardExtraShip reloads via activePlayerFlagPtr/sta; loc_16e6 via clearSoundPort3Bit/loc_1671; loc_166d via loc_1671;
// decrementShipsAndDrawReadout -> runAttractCycle via seedWorkRamImage). Interrupts disabled so the oracle's ticks can't fire a one-sided handler.
// Run: node --test games/invaders/idiomatic/test/equivalence-1a8b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a8b as oracleBody } from "../../translated/loc_1a8b.js";
import { drawLivesDigit } from "../drawLivesDigit.js";
import { drawDigit } from "../drawDigit.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1a8b;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1a8b dispatches -- drawLivesDigit == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // The oracle's tail loc_08ff/loc_1439 push/pop residue sits just below the ENTRY SP.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawLivesDigit(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the low nibble selects the glyph plotted at 0x2501 (high nibble dropped)", () => {
  // A = 0x0f -> glyph nibble 0x0f, plotted down the column from 0x2501.
  {
    const o = new Machine(ROM); o.io.setInte(false); o.regs.sp = 0x2400; o.regs.a = 0x0f;
    const c = new Machine(ROM); c.io.setInte(false); c.regs.sp = 0x2400; c.regs.a = 0x0f;
    oracle(o); drawLivesDigit(c);
    assert.equal(ramDiff(o, c), null, "A=0x0f");
    assert.equal(c.mem.read8(0x2561), 0x78, "glyph pixel row drawn at 0x2501 column");
  }
  // A = 0xf5 -> high nibble dropped (0x05); same glyph as A=0x05.
  {
    const o = new Machine(ROM); o.io.setInte(false); o.regs.sp = 0x2400; o.regs.a = 0xf5;
    const c = new Machine(ROM); c.io.setInte(false); c.regs.sp = 0x2400; c.regs.a = 0xf5;
    oracle(o); drawLivesDigit(c);
    assert.equal(ramDiff(o, c), null, "A=0xf5 (masks to 0x05)");
    const c5 = new Machine(ROM); c5.io.setInte(false); c5.regs.sp = 0x2400; c5.regs.a = 0x05;
    drawLivesDigit(c5);
    assert.equal(ramDiff(c, c5, 0x2400), null, "A=0xf5 draws the same glyph as A=0x05");
  }
});

test("TEETH: a module-mutating twin (seats the wrong screen base) diverges in RAM", () => {
  // Broken twin: seats 0x2601 instead of 0x2501, so the glyph lands one page too low.
  function loc_1a8b_broken(m, a = m.regs.a) {
    return (m.regs.hl = 0x2601, drawDigit(m, a & 0x0f)); // BUG: base is 0x2501
  }
  const o = new Machine(ROM); o.io.setInte(false); o.regs.sp = 0x2400; o.regs.a = 0x0f;
  const c = new Machine(ROM); c.io.setInte(false); c.regs.sp = 0x2400; c.regs.a = 0x0f;
  for (let a = 0x2501; a <= 0x26ff; a++) { o.mem.write8(a, 0xaa); c.mem.write8(a, 0xaa); }
  oracle(o); loc_1a8b_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the diff FAILED to catch the wrong screen base");
  assert.equal(d.addr, 0x2501, "first divergence is the glyph's real base column");
});

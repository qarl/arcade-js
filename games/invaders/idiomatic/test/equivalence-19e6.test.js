// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawReserveLifeIcons -- seat HL, and (when the entry Z flag is clear) run an A-counted loop
// of 16-byte column fills (DISSOLVED loc_1439 -> drawSpriteColumn), then fall through into the strip-blanker
// (DISSOLVED clearScreenRegion -> clearScreenRegion). The entry Z flag is a live-IN, captured as a param default. The only
// live-out is RAM: the sole caller (decrementShipsAndDrawReadout) restores A/flags via `pop psw` and hands HL to drawLivesDigit, so
// every register output is dead. Interrupts disabled so the oracle's ticks can't fire a one-sided handler.
// Run: node --test games/invaders/idiomatic/test/equivalence-19e6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_19e6 as oracleBody } from "../../translated/loc_19e6.js";
import { drawReserveLifeIcons } from "../drawReserveLifeIcons.js";
import { drawSpriteColumn } from "../drawSpriteColumn.js";
import { clearScreenStrip } from "../clearScreenStrip.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x19e6;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x19e6 dispatches -- drawReserveLifeIcons == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // The oracle's per-pass push16(0x19f5) + loc_1439/clearScreenRegion push residue sits just below the ENTRY SP.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawReserveLifeIcons(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: Z-skip clears strips; Z-clear paints A columns then clears the strips below", () => {
  // ARM A: entry Z set -> skip the loop, blank strips straight from 0x2701.
  {
    const o = new Machine(ROM); o.io.setInte(false); o.regs.sp = 0x2400; o.regs.fZ = true;
    const c = new Machine(ROM); c.io.setInte(false); c.regs.sp = 0x2400; c.regs.fZ = true;
    for (let a = 0x2701; a <= 0x35ff; a++) { o.mem.write8(a, 0xaa); c.mem.write8(a, 0xaa); }
    oracle(o); drawReserveLifeIcons(c);
    assert.equal(ramDiff(o, c), null, "arm A");
    assert.equal(c.mem.read8(0x2701), 0x00, "first strip base cleared");
    assert.equal(c.mem.read8(0x3501), 0xaa, "terminator strip base left untouched");
  }
  // ARM B: entry Z clear, A=2 -> paint columns at 0x2701 and 0x2901 from 0x1c60, then clear from 0x2b01.
  {
    const o = new Machine(ROM); o.io.setInte(false); o.regs.sp = 0x2400; o.regs.fZ = false; o.regs.a = 0x02;
    const c = new Machine(ROM); c.io.setInte(false); c.regs.sp = 0x2400; c.regs.fZ = false; c.regs.a = 0x02;
    for (let a = 0x2701; a <= 0x35ff; a++) { o.mem.write8(a, 0xaa); c.mem.write8(a, 0xaa); }
    oracle(o); drawReserveLifeIcons(c);
    assert.equal(ramDiff(o, c), null, "arm B");
    assert.equal(c.mem.read8(0x2801), 0xff, "column 1 painted (0x2701 + row 8)");
    assert.equal(c.mem.read8(0x2a01), 0xff, "column 2 painted (0x2901 + row 8)");
    assert.equal(c.mem.read8(0x2b01), 0x00, "strip below the columns cleared");
  }
});

test("TEETH: a module-mutating twin (walks one strip too far) diverges in RAM", () => {
  // Broken twin: same seat + loop, but the dissolved strip-blanker stops one strip too late (0x37 not 0x35),
  // clearing the 0x35xx strip the real routine leaves alone.
  function loc_19e6_broken(m, a = m.regs.a, z = m.regs.fZ) {
    let hl = 0x2701;
    if (!z) {
      let counter = a;
      do { hl = drawSpriteColumn(m, hl, 0x1c60, 0x10); counter = (counter - 1) & 0xff; } while (counter !== 0);
    }
    let cur = hl;
    do { cur = clearScreenStrip(m, 0x10, cur); } while (((cur >> 8) & 0xff) !== 0x37); // BUG: 0x37, not 0x35
    return [(m.regs.hl = cur)];
  }
  const o = new Machine(ROM); o.io.setInte(false); o.regs.sp = 0x2400; o.regs.fZ = true;
  const c = new Machine(ROM); c.io.setInte(false); c.regs.sp = 0x2400; c.regs.fZ = true;
  for (let a = 0x2701; a <= 0x36ff; a++) { o.mem.write8(a, 0xaa); c.mem.write8(a, 0xaa); }
  oracle(o); loc_19e6_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the diff FAILED to catch the over-clear");
  assert.equal(d.addr, 0x3501, "first divergence is the extra strip the real routine leaves alone");
});

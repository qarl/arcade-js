// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for scaleXToBlock (X-scale) -- read the object X cell, count the 0x10 steps to lift it to
// the threshold in L (dissolved into countStepsToThreshold), then leave the block index (count-1) in B and
// the leftover (stepped-0x10) in L/A. No RAM write, so the contract is the (L, B) live-out the caller reads
// back: L folds into the SHLD word, B is the index handed to alienGridCellPtr (it survives the intervening Y-scale).
// Run: node --test games/invaders/idiomatic/test/equivalence-1562.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1562 as oracleBody } from "../../translated/loc_1562.js";
import { scaleXToBlock } from "../scaleXToBlock.js";
import { countStepsToThreshold } from "../countStepsToThreshold.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { loc_2009 } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1562;

// Reference: countStepsToThreshold over (val, thresh), then the tail -- L/A = stepped-0x10, B = count-1.
const scale = (val, thresh) => {
  let a = val & 0xff, h = thresh & 0xff, c = 0;
  if (a >= h) { do { c = (c + 1) & 0xff; a = (a + 0x10) & 0xff; } while (a & 0x80); }
  while (a < h) { a = (a + 0x10) & 0xff; c = (c + 1) & 0xff; }
  return { residual: (a - 0x10) & 0xff, index: (c - 1) & 0xff };
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1562 dispatches -- scaleXToBlock == oracle in RAM (-stack) and L/B/A", () => {
  for (const cap of CAPS) {
    // The oracle's `call 0x1554` pushes a return word just below the ENTRY SP; the module never touches
    // the stack, so exclude relative to that SP, not the fixed window.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); scaleXToBlock(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.l, o.regs.l, "L live-out matches the oracle");
    assert.equal(c.regs.b, o.regs.b, "B (block index) live-out matches the oracle");
    assert.equal(c.regs.a, o.regs.a, "A residual matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: L holds stepped-0x10, B holds count-1, across cnc-skip / cnc-fire / negative paths", () => {
  const cases = [
    { val: 0x00, thresh: 0x30 }, // val < thresh: pure loop
    { val: 0x30, thresh: 0x30 }, // val == thresh: cnc fires, one 0x1590 bump
    { val: 0x40, thresh: 0x20 }, // val >= thresh non-negative
    { val: 0x80, thresh: 0x10 }, // negative val: normalize up first
    { val: 0xf0, thresh: 0x08 }, // deep negative
  ];
  for (const { val, thresh } of cases) {
    // Seed entry carry on both sides: the SBI 0x10 relies on countStepsToThreshold clearing carry first.
    const o = new Machine(ROM); o.regs.l = thresh; o.regs.sp = 0x2400; o.regs.fC = true; o.mem.write8(loc_2009, val);
    const c = new Machine(ROM); c.regs.l = thresh; c.regs.sp = 0x2400; c.regs.fC = true; c.mem.write8(loc_2009, val);
    oracle(o); scaleXToBlock(c);
    const { residual, index } = scale(val, thresh);
    const tag = `val=0x${val.toString(16)} thresh=0x${thresh.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.l, residual, `L = stepped-0x10: ${tag}`);
    assert.equal(c.regs.b, index, `B = count-1: ${tag}`);
    assert.equal(c.regs.a, residual, `A = residual: ${tag}`);
    assert.equal(c.regs.l, o.regs.l, `L matches oracle: ${tag}`);
    assert.equal(c.regs.b, o.regs.b, `B matches oracle: ${tag}`);
    assert.equal(c.regs.a, o.regs.a, `A matches oracle: ${tag}`);
  }
});

test("TEETH: a module-mutating twin (B = count, skips the dcr) diverges in the B live-out", () => {
  // Real module shape, one broken step: leaves the raw count in B instead of count-1.
  function loc_1562_broken(m, l = m.regs.l) {
    const [stepped, count] = countStepsToThreshold(m, m.mem8[loc_2009], l);
    const residual = (stepped - 0x10) & 0xff;
    return [(m.regs.a = residual), (m.regs.l = residual), (m.regs.b = count & 0xff)]; // BUG: no dcr
  }
  const val = 0x00, thresh = 0x30;
  const o = new Machine(ROM); o.regs.l = thresh; o.regs.sp = 0x2400; o.mem.write8(loc_2009, val);
  const c = new Machine(ROM); c.regs.l = thresh; c.regs.sp = 0x2400; c.mem.write8(loc_2009, val);
  oracle(o); loc_1562_broken(c);
  assert.notEqual(c.regs.b, o.regs.b, "the B live-out check FAILED to catch the missing dcr");
});

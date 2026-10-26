// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for scaleYToBlock (Y-scale) -- read the object Y cell, count the 0x10 steps to lift it to
// the threshold in H (dissolved into countStepsToThreshold), then leave the leftover (stepped-0x10) in H/A.
// No RAM write, so the contract is the (H, C) live-out the callers read back: H folds into the SHLD word,
// and stepAlienShot reads C (the step count countStepsToThreshold leaves) straight into A.
// Run: node --test games/invaders/idiomatic/test/equivalence-156f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_156f as oracleBody } from "../../translated/loc_156f.js";
import { scaleYToBlock } from "../scaleYToBlock.js";
import { countStepsToThreshold } from "../countStepsToThreshold.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { loc_200a } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x156f;

// Reference: countStepsToThreshold over (val, thresh), then H/A = stepped-0x10; C = the step count.
const scale = (val, thresh) => {
  let a = val & 0xff, h = thresh & 0xff, c = 0;
  if (a >= h) { do { c = (c + 1) & 0xff; a = (a + 0x10) & 0xff; } while (a & 0x80); }
  while (a < h) { a = (a + 0x10) & 0xff; c = (c + 1) & 0xff; }
  return { residual: (a - 0x10) & 0xff, count: c };
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x156f dispatches -- scaleYToBlock == oracle in RAM (-stack) and H/C/A", () => {
  for (const cap of CAPS) {
    // The oracle's `call 0x1554` pushes a return word just below the ENTRY SP; the module never touches
    // the stack, so exclude relative to that SP, not the fixed window.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); const ret = scaleYToBlock(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.h, o.regs.h, "H live-out matches the oracle");
    assert.equal(c.regs.c, o.regs.c, "C (step count) live-out matches the oracle");
    assert.equal(c.regs.a, o.regs.a, "A residual matches the oracle");
    assert.equal(ret[2], c.regs.c, "3rd return element (C, step count) equals regs.c");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: H holds stepped-0x10 and C the step count, across cnc-skip / cnc-fire / negative paths", () => {
  const cases = [
    { val: 0x00, thresh: 0x30 }, // val < thresh: pure loop
    { val: 0x30, thresh: 0x30 }, // val == thresh: cnc fires
    { val: 0x40, thresh: 0x20 }, // val >= thresh non-negative
    { val: 0x80, thresh: 0x10 }, // negative val: normalize up first
    { val: 0xf0, thresh: 0x08 }, // deep negative
  ];
  for (const { val, thresh } of cases) {
    // Seed entry carry on both sides: the SBI 0x10 relies on countStepsToThreshold clearing carry first.
    const o = new Machine(ROM); o.regs.h = thresh; o.regs.sp = 0x2400; o.regs.fC = true; o.mem.write8(loc_200a, val);
    const c = new Machine(ROM); c.regs.h = thresh; c.regs.sp = 0x2400; c.regs.fC = true; c.mem.write8(loc_200a, val);
    oracle(o); const ret = scaleYToBlock(c);
    const { residual, count } = scale(val, thresh);
    const tag = `val=0x${val.toString(16)} thresh=0x${thresh.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.h, residual, `H = stepped-0x10: ${tag}`);
    assert.equal(c.regs.c, count, `C = step count: ${tag}`);
    assert.equal(c.regs.a, residual, `A = residual: ${tag}`);
    assert.equal(ret[2], c.regs.c, `3rd return element (C, step count) equals regs.c: ${tag}`);
    assert.equal(c.regs.h, o.regs.h, `H matches oracle: ${tag}`);
    assert.equal(c.regs.c, o.regs.c, `C matches oracle: ${tag}`);
    assert.equal(c.regs.a, o.regs.a, `A matches oracle: ${tag}`);
  }
});

test("TEETH: a module-mutating twin (skips the -0x10 residual) diverges in the H live-out", () => {
  // Real module shape, one broken step: stores the stepped value straight into H without the SBI 0x10.
  function loc_156f_broken(m, h = m.regs.h) {
    const [stepped] = countStepsToThreshold(m, m.mem8[loc_200a], h);
    return [(m.regs.a = stepped), (m.regs.h = stepped)]; // BUG: no -0x10
  }
  const val = 0x00, thresh = 0x30;
  const o = new Machine(ROM); o.regs.h = thresh; o.regs.sp = 0x2400; o.mem.write8(loc_200a, val);
  const c = new Machine(ROM); c.regs.h = thresh; c.regs.sp = 0x2400; c.mem.write8(loc_200a, val);
  oracle(o); loc_156f_broken(c);
  assert.notEqual(c.regs.h, o.regs.h, "the H live-out check FAILED to catch the missing residual subtract");
});

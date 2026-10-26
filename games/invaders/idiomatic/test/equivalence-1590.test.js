// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for normalizeUpBySteps (ROM 0x1590) -- "normalize A upward". Inputs A (byte) and C (count);
// runs at least once: add 0x10 / bump C until A's sign bit clears. Live-out: A (normalized) AND C (step
// count), both read back by the caller countStepsToThreshold. No RAM write, so the contract is the (A, C) live-out
// (RAM diff stays null and is checked for accidental writes).
// Run: node --test games/invaders/idiomatic/test/equivalence-1590.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1590 as oracleBody } from "../../translated/loc_1590.js";
import { normalizeUpBySteps } from "../normalizeUpBySteps.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1590;

// Reference normalization: at least one pass, then continue while the sign bit is set.
const expect = (a, c) => {
  do { c = (c + 1) & 0xff; a = (a + 0x10) & 0xff; } while (a & 0x80);
  return [a, c];
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1590 dispatches -- normalizeUpBySteps == oracle in RAM (-stack) and A/C", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); normalizeUpBySteps(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
    assert.equal(c.regs.c, o.regs.c, "C live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: A normalizes and C counts the steps, for several A/C", () => {
  const cases = [
    { a: 0xb0, c: 0x00 }, // frozen translated test: -> A=0x00, C=0x05
    { a: 0x80, c: 0x00 },
    { a: 0xf0, c: 0x05 },
    { a: 0x00, c: 0x00 }, // already non-negative, but the loop still runs once
    { a: 0x7f, c: 0x00 }, // +0x10 goes negative first, then wraps around
  ];
  for (const { a, c } of cases) {
    const o = new Machine(ROM); o.regs.a = a; o.regs.c = c;
    const cc = new Machine(ROM); cc.regs.a = a; cc.regs.c = c;
    oracle(o);
    const ret = normalizeUpBySteps(cc);
    const [ea, ec] = expect(a, c);
    const tag = `A=0x${a.toString(16)} C=0x${c.toString(16)}`;
    assert.equal(ramDiff(o, cc), null, tag);
    assert.equal(cc.regs.a, ea, `A normalized: ${tag}`);
    assert.equal(cc.regs.c, ec, `C step count: ${tag}`);
    assert.equal((cc.regs.a & 0x80), 0, `A ends non-negative: ${tag}`);
    assert.deepEqual(ret, [ea, ec], `tuple return: ${tag}`);
    assert.equal(cc.regs.a, o.regs.a, `A matches oracle: ${tag}`);
    assert.equal(cc.regs.c, o.regs.c, `C matches oracle: ${tag}`);
  }
});

test("TEETH: a broken twin (0x08 step instead of 0x10) diverges in A/C", () => {
  const a = 0x80, c = 0x00;
  const o = new Machine(ROM); o.regs.a = a; o.regs.c = c;
  oracle(o);
  // broken twin of normalizeUpBySteps: adds the wrong step
  let ba = a, bc = c;
  do { bc = (bc + 1) & 0xff; ba = (ba + 0x08) & 0xff; } while (ba & 0x80);
  assert.ok(ba !== o.regs.a || bc !== o.regs.c,
    "the A/C live-out check FAILED to catch the wrong step size");
});

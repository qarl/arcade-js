// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for foldSignedMagnitude (ROM 0x382b) -- the "abs" tail: when the N flag says A is
// negative, negate A (falls into the 0x382d two's-complement negate); otherwise pass A through. Like the
// negate it wraps, this is a pure-register leaf that writes NO memory, so the RAM diff is trivially null
// and cannot by itself verify the transform. The behavioural contract is therefore the register output
// (m.regs.a) across the whole byte range AND both flag states; the CAPTURE arm still proves the rewrite
// touches no RAM on real dispatches, and the SP-tooth proves it is seam-placeable (omits its ROM ret).
// Run: node --test games/centiped/idiomatic/test/equivalence-382b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_382b as oracleRom } from "../../translated/loc_382b.js";
import { foldSignedMagnitude } from "../foldSignedMagnitude.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x382b;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

// A fresh machine with A and the N flag seated; SP at its post-reset seat so the oracle's m.ret (and the
// 0x382d negate's m.ret) have a word to pull.
function seed(a, negative) {
  const m = new Machine(ROM);
  m.regs.a = a & 0xff;
  m.regs.fN = !!negative;
  return m;
}

test("CAPTURE: real 0x382b dispatches -- foldSignedMagnitude writes no RAM (== oracle in RAM -stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); foldSignedMagnitude(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: foldSignedMagnitude(A) == oracle in register A across byte range x both flag states", () => {
  for (let a = 0; a <= 0xff; a++) {
    for (const negative of [false, true]) {
      const o = seed(a, negative), c = seed(a, negative);
      oracle(o); foldSignedMagnitude(c);
      const label = `A=0x${a.toString(16)} N=${negative}`;
      assert.equal(c.regs.a, o.regs.a, label);
      assert.equal(c.regs.a, negative ? (0x100 - a) & 0xff : a, `${label} value`);
      assert.equal(ramDiff(o, c), null, `${label} RAM`);
    }
  }
  // Fixed points: N clear passes A through; N set negates.
  assert.equal(seedFold(0x05, false), 0x05);
  assert.equal(seedFold(0x05, true), 0xfb); // -5
  assert.equal(seedFold(0x80, true), 0x80); // -128 is its own negate
  assert.equal(seedFold(0x00, true), 0x00);
  function seedFold(a, n) { const c = seed(a, n); foldSignedMagnitude(c); return c.regs.a; }
});

test("TEETH: a twin that always negates (ignores the sign flag) diverges in A for N-clear inputs", () => {
  const brokenFold = (m, a = m.regs.a) => (m.regs.a = (-a) & 0xff); // BUG: negate unconditionally
  let caught = 0;
  for (let a = 1; a <= 0xff; a++) { // a=0 negates to 0, no divergence; skip it
    const o = seed(a, false), c = seed(a, false); // N clear: oracle must pass A through
    oracle(o); brokenFold(c);
    if (c.regs.a !== o.regs.a) caught++;
  }
  assert.ok(caught > 0, "the register check FAILED to catch the unconditional negate");
});

test("TEETH(SP): foldSignedMagnitude is seam-placeable; a twin that pushes is not", () => {
  const entry = CAPS.length ? CAPS[0].clone() : seed(0x37, true);
  assert.equal(seamPlaceable(withOmittedRet, foldSignedMagnitude, TARGET, entry.clone()).placeable, true);
  const spLeak = (m) => { m.push8(0x00); m.regs.a = (-m.regs.a) & 0xff; };
  assert.equal(seamPlaceable(withOmittedRet, spLeak, TARGET, entry.clone()).placeable, false);
});

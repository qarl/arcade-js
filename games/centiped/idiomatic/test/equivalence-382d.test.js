// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for negateA (ROM 0x382d) -- two's-complement negate of A (EOR #$FF / CLC / ADC #$01).
// This is a pure-register leaf: it writes NO memory, so the RAM diff is trivially null and cannot by
// itself verify the transform. The behavioural contract is therefore the register output (m.regs.a),
// checked in the CRAFTED arm across the full byte range; the CAPTURE arm still proves the rewrite touches
// no RAM on real dispatches, and the SP-tooth proves it is seam-placeable (omits its ROM ret).
// Run: node --test games/centiped/idiomatic/test/equivalence-382d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_382d as oracleRom } from "../../translated/loc_382d.js";
import { negateA } from "../negateA.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x382d;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

// A fresh machine with A seated; SP at its post-reset seat so the oracle's m.ret has a word to pull.
function seed(a) {
  const m = new Machine(ROM);
  m.regs.a = a & 0xff;
  return m;
}

test("CAPTURE: real 0x382d dispatches -- negateA writes no RAM (== oracle in RAM -stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); negateA(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: negateA(A) == oracle in register A across the whole byte range", () => {
  for (let a = 0; a <= 0xff; a++) {
    const o = seed(a), c = seed(a);
    oracle(o); negateA(c);
    assert.equal(c.regs.a, o.regs.a, `A=0x${a.toString(16)}`);
    assert.equal(c.regs.a, (0x100 - a) & 0xff, `A=0x${a.toString(16)} value`);
    assert.equal(ramDiff(o, c), null, `A=0x${a.toString(16)} RAM`);
  }
  // Spot-check the fixed points the idiom is famous for.
  assert.equal(seedNegate(0x00), 0x00);
  assert.equal(seedNegate(0x01), 0xff);
  assert.equal(seedNegate(0x80), 0x80);
  function seedNegate(a) { const c = seed(a); negateA(c); return c.regs.a; }
});

test("TEETH: a twin that forgets the +1 (bitwise NOT only) diverges in A", () => {
  const brokenNegate = (m, a = m.regs.a) => (m.regs.a = (~a) & 0xff); // BUG: EOR #$FF without the ADC #1
  let caught = 0;
  for (let a = 0; a <= 0xff; a++) {
    const o = seed(a), c = seed(a);
    oracle(o); brokenNegate(c);
    if (c.regs.a !== o.regs.a) caught++;
  }
  assert.ok(caught > 0, "the register check FAILED to catch the missing +1");
});

test("TEETH(SP): negateA is seam-placeable; a twin that pushes is not", () => {
  const entry = CAPS.length ? CAPS[0].clone() : seed(0x37);
  assert.equal(seamPlaceable(withOmittedRet, negateA, TARGET, entry.clone()).placeable, true);
  // Null-mutant: a rewrite that moves SP (a stray push) must be rejected by the tooth.
  const spLeak = (m) => { m.push8(0x00); m.regs.a = (-m.regs.a) & 0xff; };
  assert.equal(seamPlaceable(withOmittedRet, spLeak, TARGET, entry.clone()).placeable, false);
});

// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for plotNormalizedCharCode (ROM 0x385c) -- normalize a char/nibble code (carry-clear:
// ORA #$20; carry-set: AND #$0f then ORA #$20 unless the nibble is 0; then a 0x2A wrap SBCs #$29) and plot
// it via 0x3836 through the (loc_91/loc_92) cursor. The ROM's PHP/PLP around the CMP/SBC/JSR is balanced
// stack scratch (excluded from the diff) and unobservable to callers, so no flags are modelled. The CAPTURE
// arm checks real dispatches; the CRAFTED arm sweeps the whole A range in both carry states against the
// oracle and spot-checks the wrap boundary + zero-nibble; TEETH proves the RAM diff catches a twin that
// skips the 0x2A wrap; the SP-tooth proves the rewrite is seam-placeable.
// Run: node --test games/centiped/idiomatic/test/equivalence-385c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_385c as oracleRom } from "../../translated/loc_385c.js";
import { plotNormalizedCharCode } from "../plotNormalizedCharCode.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_91, loc_92, loc_ef, loc_f3 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x385c;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

// Seat A, the carry input, the cursor (loc_91/loc_92) and the mask/high-adjust cells; SP at its post-reset
// seat so the oracle's internal JSR/PHP/PLP and outer m.ret have stack words to work with.
function seed(a, carry, ptr, mask, f3) {
  const m = new Machine(ROM);
  m.regs.a = a & 0xff;
  m.regs.fC = !!carry;
  m.mem.write16(loc_91, ptr & 0xffff); // loc_91 low, loc_92 high
  m.mem.write8(loc_ef, mask & 0xff);
  m.mem.write8(loc_f3, f3 & 0xff);
  return m;
}

test("CAPTURE: real 0x385c dispatches -- plotNormalizedCharCode == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); plotNormalizedCharCode(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: normalize + plot matches the oracle across the whole A range x both carry states", () => {
  for (let a = 0; a <= 0xff; a++) {
    for (const carry of [0, 1]) {
      const o = seed(a, carry, 0x0300, 0x00, 0x00);
      const c = seed(a, carry, 0x0300, 0x00, 0x00);
      oracle(o); plotNormalizedCharCode(c);
      assert.equal(ramDiff(o, c), null, `A=0x${a.toString(16)} C=${carry}`);
    }
  }
});

test("CRAFTED: the normalized tile byte hits the cursor for the folding boundary cases", () => {
  // mask=0 so the plotted byte equals the normalized value; exp hand-computed from the ROM.
  const cases = [
    { a: 0x35, carry: 1, exp: 0x25 }, // nibble 5 -> 0x25 (< 0x2a, no wrap)
    { a: 0x3c, carry: 1, exp: 0x03 }, // nibble 0xc -> 0x2c -> wrap -> 0x03
    { a: 0x40, carry: 1, exp: 0x00 }, // nibble 0 stays 0 (BEQ skips the ORA)
    { a: 0x39, carry: 1, exp: 0x29 }, // nibble 9 -> 0x29 (boundary: stays)
    { a: 0x3a, carry: 1, exp: 0x01 }, // nibble 0xa -> 0x2a (boundary: wraps -> 0x01)
    { a: 0x05, carry: 0, exp: 0x25 }, // carry clear: 0x05 | 0x20 = 0x25
    { a: 0x0f, carry: 0, exp: 0x06 }, // carry clear: 0x2f -> wrap -> 0x06
  ];
  for (const { a, carry, exp } of cases) {
    const o = seed(a, carry, 0x0300, 0x00, 0x00);
    const c = seed(a, carry, 0x0300, 0x00, 0x00);
    oracle(o); plotNormalizedCharCode(c);
    const label = `A=0x${a.toString(16)} C=${carry}`;
    assert.equal(ramDiff(o, c), null, label);
    assert.equal(c.mem.read8(0x0300), exp, `plotted byte ${label}`);
  }
});

test("TEETH: a twin that skips the 0x2A wrap is caught by the RAM diff", () => {
  const brokenNormalize = (m, a = m.regs.a, carrySet = m.regs.fC) => {
    let v = a & 0xff;
    if (carrySet) { v &= 0x0f; if (v !== 0) v = (v | 0x20) & 0xff; }
    else v = (v | 0x20) & 0xff;
    // BUG: never subtracts 0x29, so digit codes 0x2a-0x2f are plotted unwrapped.
    writeThrough(m, v);
  };
  function writeThrough(m, v) {
    const { mem } = m;
    const mask = mem.read8(loc_ef);
    const target = mem.read16(loc_91) & 0xffff;
    mem.write8(target, v === 0 ? 0 : (v ^ mask) & 0xff);
    const lowSum = mem.read8(loc_91) + ((0x20 ^ mask) & 0xff);
    mem.write8(loc_91, lowSum & 0xff);
    const carry = lowSum > 0xff ? 1 : 0;
    mem.write8(loc_92, (mem.read8(loc_f3) + mem.read8(loc_92) + carry) & 0xff);
  }
  const o = seed(0x3c, 1, 0x0300, 0x00, 0x00); // wraps to 0x03 in the oracle
  const c = seed(0x3c, 1, 0x0300, 0x00, 0x00);
  oracle(o); brokenNormalize(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the skipped 0x2A wrap");
  assert.equal(d.addr, 0x0300);
});

test("TEETH(SP): the rewrite is seam-placeable; a twin that pushes is not", () => {
  const entry = CAPS.length ? CAPS[0].clone() : seed(0x35, 1, 0x0300, 0x00, 0x00);
  assert.equal(
    seamPlaceable(withOmittedRet, plotNormalizedCharCode, TARGET, entry.clone()).placeable,
    true,
  );
  const spLeak = (m) => { m.push8(0x00); };
  assert.equal(seamPlaceable(withOmittedRet, spLeak, TARGET, entry.clone()).placeable, false);
});

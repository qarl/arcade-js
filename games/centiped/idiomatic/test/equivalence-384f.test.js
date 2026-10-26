// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for plotByteAsTwoDigits (ROM 0x384f) -- plot a byte as its high then low nibble digit
// through the loc_91/loc_92 draw cursor (each digit normalized + plotted by the 0x385c helper). The entry
// carry selects digit mode for the high nibble; the low nibble inherits carry only when the high nibble was
// a zero digit, so its blanking depends on that inheritance. Observable output is RAM only (the two plotted
// cells + the advanced cursor). CAPTURE replays real boot dispatches; the CRAFTED arm sweeps the whole byte
// range x both carry states; TEETH proves the RAM diff catches a twin that reuses the entry carry for the
// low digit; the SP-tooth proves the SP-neutral rewrite is seam-placeable and a pushing twin is not.
// Run: node --test games/centiped/idiomatic/test/equivalence-384f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_384f as oracleRom } from "../../translated/loc_384f.js";
import { plotByteAsTwoDigits } from "../plotByteAsTwoDigits.js";
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

const TARGET = 0x384f;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Seat the byte, the carry input, the draw cursor (loc_91/loc_92) and the mask/high-adjust cells.
function seed(a, carry, ptr = 0x0300, mask = 0x00, f3 = 0x00) {
  const m = new Machine(ROM);
  m.regs.a = a & 0xff;
  m.regs.fC = !!carry;
  m.mem.write16(loc_91, ptr & 0xffff);
  m.mem.write8(loc_ef, mask & 0xff);
  m.mem.write8(loc_f3, f3 & 0xff);
  return m;
}

test("CAPTURE: real 0x384f dispatches -- plotByteAsTwoDigits == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "no 0x384f dispatches captured");
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); plotByteAsTwoDigits(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: two-digit plot matches the oracle across the whole byte range x both carry states", () => {
  for (let a = 0; a <= 0xff; a++) {
    for (const carry of [0, 1]) {
      const o = seed(a, carry), c = seed(a, carry);
      oracle(o); plotByteAsTwoDigits(c);
      assert.equal(ramDiff(o, c), null, `A=0x${a.toString(16)} C=${carry}`);
    }
  }
});

test("CRAFTED: the low-digit carry-inheritance boundary matches the oracle", () => {
  // Cases where the low digit's mode depends on the high nibble being a zero digit.
  const cases = [
    { a: 0x00, carry: 1 }, // high 0 in digit mode -> low inherits carry
    { a: 0x00, carry: 0 }, // carry clear both digits
    { a: 0x10, carry: 1 }, // high 1 (nonzero) -> low carry cleared
    { a: 0x05, carry: 1 }, // high 0 -> low inherits carry
    { a: 0x50, carry: 1 }, // high 5 (nonzero) -> low carry cleared
  ];
  for (const { a, carry } of cases) {
    const o = seed(a, carry), c = seed(a, carry);
    oracle(o); plotByteAsTwoDigits(c);
    assert.equal(ramDiff(o, c), null, `A=0x${a.toString(16)} C=${carry}`);
  }
});

test("TEETH: a twin that reuses the entry carry for the low digit is caught by the RAM diff", () => {
  // Reusing the entry carry (instead of the high==0 gate) diverges when the high nibble is nonzero and the
  // low nibble is zero: the low digit is blanked to 0 rather than plotted as the 0x20 space code.
  const broken = (m, a = m.regs.a, carry = m.regs.fC) => {
    const byte = a & 0xff;
    plotNormalizedCharCode(m, byte >> 4, carry);
    plotNormalizedCharCode(m, byte & 0x0f, carry); // BUG: should clear carry unless the high nibble was 0
  };
  const o = seed(0x10, 1), c = seed(0x10, 1);
  oracle(o); broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong low-digit carry");
});

test("SP-TOOTH: the SP-neutral rewrite is seam-placeable; a pushing twin is not", () => {
  const entry = CAPS.length ? CAPS[0].clone() : seed(0x35, 1);
  const r = seamPlaceable(withOmittedRet, plotByteAsTwoDigits, TARGET, entry);
  assert.equal(r.placeable, true, `plotByteAsTwoDigits must be seam-placeable; got: ${r.error}`);
  const mutant = (m, a = m.regs.a) => { m.push16(0xffff); return plotByteAsTwoDigits(m, a); };
  const r2 = seamPlaceable(withOmittedRet, mutant, TARGET, (CAPS.length ? CAPS[0].clone() : seed(0x35, 1)));
  assert.equal(r2.placeable, false, "the SP-tooth FAILED to refuse an SP-adrift mutant");
  console.log("  SP-TOOTH: SP-neutral rewrite placeable; adrift mutant refused");
});

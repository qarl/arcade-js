// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advancePathAccumulator (0x2db6) -- steps a segment's 16-bit BCD position toward
// its target, rolling a companion pair on a decimal carry, and on arrival advances the target by the
// indexed table step, bumps the phase index and redraws the side borders. A leaf: it omits the ROM ret
// and the seam completes it. Decimal arithmetic is reproduced exactly (NMOS value + carry), so operands
// outside valid packed-BCD (a signed velocity in $8b) stay byte-for-byte equal to the source.
// Run: node --test games/centiped/idiomatic/test/equivalence-2db6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2db6 as oracleRom } from "../../translated/loc_2db6.js";
import { advancePathAccumulator } from "../advancePathAccumulator.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_86, loc_88, loc_8b, loc_8d,
  loc_a1, loc_a4, loc_a5, loc_a6, loc_a7, loc_a9, loc_ab, loc_ad, loc_af,
  CONFIG_DIP_BYTE, loc_f6, loc_f7,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2db6;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any gap */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

function seed({ a = 0, x = 0, cells = {} } = {}) {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.mem.write8(0x0100 | ((0xfd + 1) & 0xff), 0x34); // caller-return (ret-1) lo
  m.mem.write8(0x0100 | ((0xfd + 2) & 0xff), 0x12); // caller-return (ret-1) hi
  m.regs.a = a;
  m.regs.x = x;
  for (const [addr, v] of Object.entries(cells)) m.mem.write8(Number(addr), v);
  return m;
}

test("CAPTURE: real 0x2db6 dispatches -- advancePathAccumulator == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); advancePathAccumulator(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: every path (disabled / step / rollover / reach-target / phase ceiling / index>0) == oracle", () => {
  const arms = [
    { tag: "disabled ($86 negative)", a: 0x01, x: 0x07, cells: { [loc_86]: 0x80 } },
    { tag: "step, no rollover, target not reached", a: 0x01, x: 0x03,
      cells: { [loc_86]: 0, [loc_88]: 0, [loc_8b]: 0, [loc_a7]: 0, [loc_a9]: 0, [loc_ad]: 0x99, [loc_af]: 0x99, [loc_ab]: 0, [loc_a1]: 0 } },
    { tag: "decimal rollover steps the companion pair", a: 0x00, x: 0x02,
      cells: { [loc_86]: 0, [loc_88]: 0, [loc_8b]: 0x01, [loc_a7]: 0x99, [loc_a9]: 0x99, [loc_a1]: 0x05, [loc_ab]: 0, [loc_ad]: 0x99, [loc_af]: 0x99 } },
    { tag: "reach target, phase < 6 -> advance + draw", a: 0x01, x: 0x00,
      cells: { [loc_86]: 0, [loc_88]: 0, [loc_8b]: 0, [loc_a7]: 0, [loc_a9]: 0x99, [loc_ab]: 0x99, [loc_ad]: 0, [loc_af]: 0, [loc_a4]: 0x00, [CONFIG_DIP_BYTE]: 0, [loc_f6]: 0, [loc_f7]: 0, [loc_a5]: 0x03, [loc_a6]: 0x03 } },
    { tag: "reach target, phase == 6 -> skip", a: 0x01, x: 0x00,
      cells: { [loc_86]: 0, [loc_88]: 0, [loc_8b]: 0, [loc_a7]: 0, [loc_a9]: 0x99, [loc_ab]: 0x99, [loc_ad]: 0, [loc_af]: 0, [loc_a4]: 0x06, [CONFIG_DIP_BYTE]: 0 } },
    { tag: "reach target, dip index 2", a: 0x02, x: 0x01,
      cells: { [loc_86]: 0, [loc_88]: 0, [loc_8b]: 0, [loc_a7]: 0, [loc_a9]: 0x99, [loc_ab]: 0x99, [loc_ad]: 0, [loc_af]: 0, [loc_a4]: 0x02, [CONFIG_DIP_BYTE]: 0x10, [loc_f6]: 0x11, [loc_f7]: 0x22, [loc_a5]: 0x02, [loc_a6]: 0x05 } },
    // i=1 reaches target ($ac:$aa >= $b0:$ae): $a4,x is $a5, so it MUST hold a valid phase (<= 6). A
    // phase > 6 (e.g. 0x99) drives BOTH the oracle and the module into the documented 2dfd BCS-to-self
    // watchdog spin -- a real hardware hang, not a divergence -- so the arm must seat a bumpable phase.
    { tag: "nonzero index i=1", a: 0x11, x: 0x00,
      cells: { [loc_86]: 0, [loc_88]: 0x01, 0x8c: 0x01, [loc_8b]: 0x11, 0xa8: 0x05, 0xaa: 0x22, 0xa2: 0x40, 0xac: 0x03, 0xae: 0x50, 0xb0: 0x00, [loc_a5]: 0x00 } },
  ];
  for (const s of arms) {
    const base = seed(s);
    const o = base.clone(), c = base.clone();
    oracle(o); advancePathAccumulator(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
  console.log("  CRAFTED: advancePathAccumulator == oracle on all 7 arms");
});

test("CRAFTED: disabled path leaves the index-save cell untouched (positive control)", () => {
  const base = seed({ a: 0x01, x: 0x07, cells: { [loc_86]: 0x80, [loc_8d]: 0x00 } });
  const o = base.clone();
  oracle(o);
  assert.equal(o.mem.read8(loc_8d), 0x00, "disabled path must not save the index");
});

test("TEETH: a skipped phase bump and a skipped index-save are caught by the RAM diff", () => {
  const base = seed({ a: 0x01, x: 0x05,
    cells: { [loc_86]: 0, [loc_88]: 0, [loc_8b]: 0, [loc_a7]: 0, [loc_a9]: 0x99, [loc_ab]: 0x99, [loc_ad]: 0, [loc_af]: 0, [loc_a4]: 0x00, [CONFIG_DIP_BYTE]: 0, [loc_f6]: 0, [loc_f7]: 0, [loc_a5]: 0x03, [loc_a6]: 0x03 } });
  const o = base.clone();
  oracle(o);
  assert.equal(o.mem.read8(loc_a4), 0x01, "precondition: oracle bumped the phase index 0 -> 1");
  assert.notEqual(0x00, o.mem.read8(loc_a4), "the RAM diff FAILED to distinguish a skipped phase bump");
  assert.equal(o.mem.read8(loc_8d), 0x05, "precondition: oracle saved the caller index into $8d");
  assert.notEqual(0x00, o.mem.read8(loc_8d), "the RAM diff FAILED to distinguish a skipped index-save");
  console.log("  TEETH: phase-bump and index-save cells carry distinguishing values");
});

test("SP-TOOTH: the leaf is seam-placeable, and a leaked push is refused", () => {
  const m = seed({ cells: { [loc_86]: 0x80 } }); // disabled path -> plain leaf, SP unmoved
  const r = seamPlaceable(withOmittedRet, advancePathAccumulator, TARGET, m);
  assert.equal(r.placeable, true, `advancePathAccumulator must be seam-placeable; got: ${r.error}`);
  const leaky = (mm) => { mm.push16(0x1234); };
  const bad = seamPlaceable(withOmittedRet, leaky, TARGET, seed({ cells: { [loc_86]: 0x80 } }));
  assert.equal(bad.placeable, false, "the SP tooth FAILED to refuse a leaked push16");
  console.log("  SP-TOOTH: leaf placeable; leaked push refused");
});

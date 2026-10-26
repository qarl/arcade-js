// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clampAndHalveSignedDelta (ROM 0x3226) -- clamp A to the playfield rails, then
// arithmetic-halve it, packing the dropped LSB into a sign byte. No RAM write; THREE live-outs read back
// by the frozen callers (loc_2ace, loc_2aeb): A = 0x80/0x00 (the packed sign bit, folded into $84/$85
// via ADC), Y = arithmetic (clamped >> 1), and carry = 0 (consumed by that ADC). A leaf: it omits the
// ROM ret and the seam completes it, so the arms compare RAM (-stack) + A + Y + carry, NOT pc/SP.
// Run: node --test games/centiped/idiomatic/test/equivalence-3226.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3226 as oracleRom } from "../../translated/loc_3226.js";
import { clampAndHalveSignedDelta } from "../clampAndHalveSignedDelta.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3226;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any boot-gap throw */ }
  return caps;
}
// 0x3226 runs only from the movement accumulators (loc_2ace/loc_2aeb), a gameplay path the attract boot
// does not reach (0 dispatches through 2000 frames). The CRAFTED sweep below carries the check.
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x3226 dispatches -- clampAndHalveSignedDelta == oracle in A, Y, carry (RAM -stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); clampAndHalveSignedDelta(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches oracle");
    assert.equal(c.regs.y, o.regs.y, "Y live-out matches oracle");
    assert.equal(c.regs.fC, o.regs.fC, "carry live-out matches oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: full A sweep 0x00..0xff == oracle (A, Y, carry; no RAM write)", () => {
  for (let a = 0; a <= 0xff; a++) {
    const o = new Machine(ROM); o.regs.a = a;
    const c = new Machine(ROM); c.regs.a = a;
    oracle(o); clampAndHalveSignedDelta(c);
    const tag = `A=0x${a.toString(16)}`;
    assert.equal(ramDiff(o, c), null, `no RAM write: ${tag}`);
    assert.equal(c.regs.a, o.regs.a, `A: ${tag}`);
    assert.equal(c.regs.y, o.regs.y, `Y: ${tag}`);
    assert.equal(c.regs.fC, o.regs.fC, `carry: ${tag}`);
    assert.equal(c.regs.fC, false, `carry always clear: ${tag}`);
  }
});

test("CRAFTED: hand-derived rail-clamp + halve cases", () => {
  // [in A] -> expected [clamped, Y, A]
  const cases = [
    { a: 0x07, y: 0x03, out: 0x80 }, // below the low rail: passes through 0x07 -> Y=0x03, LSB set
    { a: 0x08, y: 0x04, out: 0x00 }, // at the low rail (not < 0x08): mid-range snaps to 0x08 -> Y=0x04
    { a: 0x40, y: 0x04, out: 0x00 }, // mid, < 0x80: snap to 0x08 -> Y=0x04
    { a: 0x7f, y: 0x04, out: 0x00 }, // just under 0x80: snap to 0x08
    { a: 0x80, y: 0xfc, out: 0x00 }, // >= 0x80 mid: snap to 0xf8 -> Y=(0x7c|0x80)=0xfc
    { a: 0xf7, y: 0xfc, out: 0x00 }, // just under the high rail: snap to 0xf8
    { a: 0xf8, y: 0xfc, out: 0x00 }, // at the high rail (>= 0xf8): passes through 0xf8 -> Y=0xfc
    { a: 0xff, y: 0xff, out: 0x80 }, // top: passes through 0xff -> Y=(0x7f|0x80)=0xff, LSB set
    { a: 0x00, y: 0x00, out: 0x00 }, // below low rail: passes through 0x00 -> Y=0
  ];
  for (const { a, y, out } of cases) {
    const c = new Machine(ROM); c.regs.a = a;
    clampAndHalveSignedDelta(c);
    const tag = `A=0x${a.toString(16)}`;
    assert.equal(c.regs.y, y, `Y ${tag}`);
    assert.equal(c.regs.a, out, `A ${tag}`);
    assert.equal(c.regs.fC, false, `carry ${tag}`);
  }
});

test("TEETH: dropping the sign-preserving halve is caught by the Y compare", () => {
  const o = new Machine(ROM); o.regs.a = 0xf8; // clamped 0xf8 -> oracle Y = 0xfc
  oracle(o);
  const brokenY = 0xf8 >> 1; // BUG: logical >>1, no sign fold -> 0x7c
  assert.notEqual(brokenY, o.regs.y, "the Y compare FAILED to catch a dropped sign bit");
});

test("TEETH: dropping the packed sign bit is caught by the A compare", () => {
  const o = new Machine(ROM); o.regs.a = 0x07; // odd -> oracle A = 0x80
  oracle(o);
  const brokenA = 0x00; // BUG: never packs the dropped LSB
  assert.notEqual(brokenA, o.regs.a, "the A compare FAILED to catch a dropped sign bit");
});

test("TEETH: a stale set carry is caught by the carry compare", () => {
  const o = new Machine(ROM); o.regs.a = 0x40;
  oracle(o); // carry-out is always clear
  const brokenCarry = true; // BUG: leaves carry set, corrupting the caller's ADC
  assert.notEqual(brokenCarry, o.regs.fC, "the carry compare FAILED to catch a stale carry");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word for the seam
  m.regs.a = 0x40;
  const r = seamPlaceable(withOmittedRet, clampAndHalveSignedDelta, TARGET, m);
  assert.equal(r.placeable, true, `clampAndHalveSignedDelta must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});

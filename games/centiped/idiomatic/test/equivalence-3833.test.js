// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for plotZpTableByteAtCursor (ROM 0x3833) -- read mem[loc_1a + Y] into A, then fall
// into 0x3836 (store the byte, XOR'd with loc_ef unless 0, through the loc_91/loc_92 cursor and advance
// it). The CAPTURE arm checks real dispatches; the CRAFTED arm drives the Y index, the source byte, the
// mask, a low->high page-cross carry and the A==0 unmasked case; TEETH proves the RAM diff catches a twin
// that fetches the wrong index (ignores Y); the SP-tooth proves the rewrite is seam-placeable.
// Run: node --test games/centiped/idiomatic/test/equivalence-3833.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3833 as oracleRom } from "../../translated/loc_3833.js";
import { plotZpTableByteAtCursor } from "../plotZpTableByteAtCursor.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_1a, loc_91, loc_92, loc_ef, loc_f3 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3833;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

// Seat Y, the source byte at (loc_1a + Y), the cursor (loc_91/loc_92), the mask/high-adjust cells.
function seed(y, tableByte, ptr, mask, f3) {
  const m = new Machine(ROM);
  m.regs.y = y & 0xff;
  m.mem.write8((loc_1a + y) & 0xffff, tableByte & 0xff);
  m.mem.write16(loc_91, ptr & 0xffff); // loc_91 low, loc_92 high
  m.mem.write8(loc_ef, mask & 0xff);
  m.mem.write8(loc_f3, f3 & 0xff);
  return m;
}

test("CAPTURE: real 0x3833 dispatches -- plotZpTableByteAtCursor == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); plotZpTableByteAtCursor(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: indexed fetch + masked store + cursor advance match the oracle", () => {
  const cases = [
    { y: 0x00, byte: 0x55, ptr: 0x0300, mask: 0x00, f3: 0x00 }, // index 0, unflipped stride
    { y: 0x03, byte: 0x55, ptr: 0x0300, mask: 0x0f, f3: 0x00 }, // masked byte (0x55 ^ 0x0f)
    { y: 0x18, byte: 0x3c, ptr: 0x0450, mask: 0xff, f3: 0xff }, // top index, flipped screen
    { y: 0x05, byte: 0x7e, ptr: 0x02f0, mask: 0x00, f3: 0x00 }, // low 0xf0 + 0x20 -> high-byte carry
    { y: 0x0a, byte: 0x00, ptr: 0x0300, mask: 0x0f, f3: 0x00 }, // source byte 0: stored UNMASKED (stays 0)
  ];
  for (const { y, byte, ptr, mask, f3 } of cases) {
    const o = seed(y, byte, ptr, mask, f3);
    const c = seed(y, byte, ptr, mask, f3);
    oracle(o); plotZpTableByteAtCursor(c);
    const label = `y=0x${y.toString(16)} byte=0x${byte.toString(16)} ptr=0x${ptr.toString(16)} mask=0x${mask.toString(16)}`;
    assert.equal(ramDiff(o, c), null, label);
    // The fetched byte landed at the pre-advance target, masked unless it was 0.
    assert.equal(c.mem.read8(ptr), byte === 0 ? 0 : (byte ^ mask) & 0xff, `stored byte ${label}`);
    // The cursor advanced: low += (0x20 ^ mask), high += f3 + carry.
    const lowSum = (ptr & 0xff) + ((0x20 ^ mask) & 0xff);
    assert.equal(c.mem.read8(loc_91), lowSum & 0xff, `loc_91 ${label}`);
    const carry = lowSum > 0xff ? 1 : 0;
    assert.equal(c.mem.read8(loc_92), (((ptr >> 8) & 0xff) + f3 + carry) & 0xff, `loc_92 ${label}`);
  }
});

test("TEETH: a twin that ignores Y (fetches loc_1a[0]) is caught by the RAM diff", () => {
  const brokenPlot = (m) => {
    const { mem } = m;
    const byte = mem.read8(loc_1a) & 0xff; // BUG: reads index 0, never adds Y
    const mask = mem.read8(loc_ef);
    const target = mem.read16(loc_91) & 0xffff;
    mem.write8(target, byte === 0 ? 0 : (byte ^ mask) & 0xff);
    const lowSum = mem.read8(loc_91) + ((0x20 ^ mask) & 0xff);
    mem.write8(loc_91, lowSum & 0xff);
    const carry = lowSum > 0xff ? 1 : 0;
    mem.write8(loc_92, (mem.read8(loc_f3) + mem.read8(loc_92) + carry) & 0xff);
  };
  // Y=3 selects a byte (0x55) that differs from loc_1a[0] (0x11) -> the plotted byte diverges.
  const o = seed(0x03, 0x55, 0x0300, 0x00, 0x00);
  const c = seed(0x03, 0x55, 0x0300, 0x00, 0x00);
  o.mem.write8(loc_1a, 0x11); c.mem.write8(loc_1a, 0x11);
  oracle(o); brokenPlot(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the ignored Y index");
  assert.equal(d.addr, 0x0300);
});

test("TEETH(SP): the rewrite is seam-placeable; a twin that pushes is not", () => {
  const entry = CAPS.length ? CAPS[0].clone() : seed(0x00, 0x40, 0x0300, 0x00, 0x00);
  assert.equal(
    seamPlaceable(withOmittedRet, plotZpTableByteAtCursor, TARGET, entry.clone()).placeable,
    true,
  );
  const spLeak = (m) => { m.push8(0x00); };
  assert.equal(seamPlaceable(withOmittedRet, spLeak, TARGET, entry.clone()).placeable, false);
});

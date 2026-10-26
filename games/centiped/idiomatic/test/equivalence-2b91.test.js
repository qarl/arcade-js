// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for maybeDecrementTableEntry (ROM 0x2b91-0x2ba8) -- a leaf range-check that forms
// v = (TILEMAP_PTR_LO & 0x1f), picks a band from loc_ef, and when v is in-band decrements the loc_d7-table entry
// at (loc_d7 + loc_88) & 0xff:  loc_ef == 0 -> decrement when v < 0x0c;  loc_ef != 0 -> decrement when
// v >= 0x14. Live-out is memory only (A/X/flags at RTS are incidental), so each side runs on a clone and
// the contract is RAM (dumpState, minus stack scratch below the entry SP). A leaf: the module omits the ROM ret and the seam
// completes it, so the arms compare RAM (-stack), NOT pc/SP.
// Run: node --test games/centiped/idiomatic/test/equivalence-2b91.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b91 as oracleRom } from "../../translated/loc_2b91.js";
import { maybeDecrementTableEntry } from "../maybeDecrementTableEntry.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { TILEMAP_PTR_LO, loc_88, loc_d7, loc_ef } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2b91;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x2b91 dispatches -- maybeDecrementTableEntry == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); maybeDecrementTableEntry(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the two bands (loc_ef==0 -> v<0x0c; loc_ef!=0 -> v>=0x14) gate the decrement", () => {
  const IDX = 0x03;                    // loc_88 selects the entry; ea = (0xd7 + 3) & 0xff = 0xda
  const EA = (loc_d7 + IDX) & 0xff;
  const START = 0x05;
  const cases = [
    // c32, cef, dec?  -- v = c32 & 0x1f
    { c32: 0x05, cef: 0x00, dec: true },  // low band: v=0x05 < 0x0c -> dec
    { c32: 0x0b, cef: 0x00, dec: true },  // low band: v=0x0b < 0x0c -> dec (boundary just under)
    { c32: 0x0c, cef: 0x00, dec: false }, // low band: v=0x0c >= 0x0c -> no-op (boundary)
    { c32: 0x10, cef: 0x00, dec: false }, // low band: v=0x10 >= 0x0c -> no-op
    { c32: 0x15, cef: 0x01, dec: true },  // high band: v=0x15 >= 0x14 -> dec
    { c32: 0x14, cef: 0x01, dec: true },  // high band: v=0x14 >= 0x14 -> dec (boundary)
    { c32: 0x13, cef: 0x01, dec: false }, // high band: v=0x13 < 0x14 -> no-op (boundary just under)
    { c32: 0x35, cef: 0x01, dec: true },  // v = 0x35 & 0x1f = 0x15 >= 0x14 -> dec (proves the & 0x1f mask)
  ];
  for (const { c32, cef, dec } of cases) {
    const seed = (m) => {
      m.regs.s = 0x30;
      m.mem.write8(TILEMAP_PTR_LO, c32); m.mem.write8(loc_ef, cef); m.mem.write8(loc_88, IDX); m.mem.write8(EA, START);
    };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); maybeDecrementTableEntry(c);
    const tag = `32=0x${c32.toString(16)} ef=${cef}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.mem.read8(EA), dec ? (START - 1) & 0xff : START, `entry ${tag}`);
  }
});

test("CRAFTED: the index (loc_88) selects which zero-page entry is decremented (d7 + x wrap)", () => {
  for (const IDX of [0x00, 0x03, 0x40]) {
    const EA = (loc_d7 + IDX) & 0xff;
    const seed = (m) => {
      m.regs.s = 0x30;
      m.mem.write8(TILEMAP_PTR_LO, 0x05); m.mem.write8(loc_ef, 0x00); m.mem.write8(loc_88, IDX); m.mem.write8(EA, 0x09);
    };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); maybeDecrementTableEntry(c);
    const tag = `idx=0x${IDX.toString(16)} ea=0x${EA.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.mem.read8(EA), 0x08, `decremented entry ${tag}`);
  }
});

test("TEETH: a twin that decrements unconditionally is caught on a no-op case", () => {
  const IDX = 0x03, EA = (loc_d7 + IDX) & 0xff;
  const seed = (m) => {
    m.regs.s = 0x30;
    m.mem.write8(TILEMAP_PTR_LO, 0x13); m.mem.write8(loc_ef, 0x01); m.mem.write8(loc_88, IDX); m.mem.write8(EA, 0x05);
  }; // high band, v=0x13 < 0x14 -> the oracle does NOT decrement
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o);
  const brokenLoc2b91 = (m) => {
    const mem = m.mem8;
    const ea = (loc_d7 + mem[loc_88]) & 0xff;
    mem[ea] = (mem[ea] - 1) & 0xff; // BUG: no band check -- decrements even out of band
  };
  brokenLoc2b91(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch an out-of-band decrement");
  assert.equal(d.addr, EA);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); // a real caller-return word (ret-1) for the seam to consume
  m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, maybeDecrementTableEntry, TARGET, m);
  assert.equal(r.placeable, true, `maybeDecrementTableEntry must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});

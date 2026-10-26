// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for selectProjectionScale (ROM 0xca48-0xca61) -- from two zero-page gates ($0117, $3d) it copies
// bit 2 into flag $a1 (eor/and/eor RMW) and stores a paired count byte to $b4. Live-out is memory only
// (A/Y at RTS are incidental), so each side runs on a clone and the contract is RAM (dumpState, minus
// stack scratch below the entry SP). A leaf: the module omits the ROM ret and the seam completes it, so the arms compare
// RAM (-stack), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-ca48.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ca48 } from "../../translated/loc_ca48.js";
import { selectProjectionScale } from "../selectProjectionScale.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_117, loc_3d, VG_MODE_FLAG, VG_SCALE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xca48;
const oracle = atEntry(loc_ca48);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xca48 dispatches -- selectProjectionScale == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); selectProjectionScale(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: both gates open -> bit 2 set in $a1 and $b4 = 0x08", () => {
  const seed = (m) => {
    m.mem.write8(loc_117, 0x01);
    m.mem.write8(loc_3d, 0x01);
    m.mem.write8(VG_MODE_FLAG, 0x03);   // bit 2 clear; low bits kept
    m.mem.write8(VG_SCALE, 0x77);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); selectProjectionScale(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after apply");
  assert.equal(c.mem.read8(VG_MODE_FLAG), 0x07, "$a1 bit 2 set, low bits preserved");
  assert.equal(c.mem.read8(VG_SCALE), 0x08, "$b4 = 0x08");
});

test("CRAFTED: a closed gate -> bit 2 cleared in $a1 and $b4 = 0x10", () => {
  const seed = (m) => {
    m.mem.write8(loc_117, 0x01);
    m.mem.write8(loc_3d, 0x00);   // second gate closed
    m.mem.write8(VG_MODE_FLAG, 0x07);   // bit 2 set; expect it cleared
    m.mem.write8(VG_SCALE, 0x77);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); selectProjectionScale(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after apply");
  assert.equal(c.mem.read8(VG_MODE_FLAG), 0x03, "$a1 bit 2 cleared, low bits preserved");
  assert.equal(c.mem.read8(VG_SCALE), 0x10, "$b4 = 0x10");
});

test("TEETH: a twin that always stores 0x10 to $b4 diverges from the oracle", () => {
  const seed = (m) => {
    m.mem.write8(loc_117, 0x01);
    m.mem.write8(loc_3d, 0x01);   // both gates open -> oracle picks 0x08
    m.mem.write8(VG_MODE_FLAG, 0x03);
    m.mem.write8(VG_SCALE, 0x77);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenCa48 = (m) => {
    const mem = m.mem8;
    const cur = mem[VG_MODE_FLAG];
    mem[VG_MODE_FLAG] = ((((0x04 ^ cur) & 0x04) ^ cur)) & 0xff;
    mem[VG_SCALE] = 0x10; // BUG: never selects the 0x08 count
  };
  brokenCa48(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the wrong $b4 store");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, selectProjectionScale, TARGET, m);
  assert.equal(r.placeable, true, `selectProjectionScale must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});

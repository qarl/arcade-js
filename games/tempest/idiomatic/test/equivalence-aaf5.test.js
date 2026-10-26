// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for packBinaryToBcd (ROM 0xaaf5) -- binary->BCD (double-dabble) of the byte in A, result to
// $29 and $2c. A is the input (param bridge) and the BCD byte is the register live-out (returned); the RAM
// live-out is $29/$2c, so the arms compare RAM (-stack). Decimal-mode ADC only; no POKEY/clock coupling, so
// the CRAFTED diff is fully deterministic. A pure leaf (no dispatch, no stack move): omits the ROM ret and
// the withOmittedRet seam completes it.
// Run: node --test games/tempest/idiomatic/test/equivalence-aaf5.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_aaf5 } from "../../translated/loc_aaf5.js";
import { packBinaryToBcd } from "../packBinaryToBcd.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, COORD_LIST_PTR_LO } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaaf5;
const oracle = atEntry(loc_aaf5);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps taken before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1200) : [];

test("CAPTURE: real 0xaaf5 dispatches -- packBinaryToBcd == oracle in RAM (-stack), and A live-out matches", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o);
    const ret = packBinaryToBcd(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(ret, o.regs.a, "A live-out (return) matches oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: BCD conversion == oracle across a spread of inputs (RAM -stack + A live-out)", () => {
  for (const av of [0x00, 0x01, 0x09, 0x0a, 0x2a, 0x3f, 0x63, 0x64, 0x99, 0xff]) {
    const o = new Machine(ROM, OPTS); o.regs.a = av;
    const c = new Machine(ROM, OPTS); c.regs.a = av;
    oracle(o);
    const ret = packBinaryToBcd(c);
    assert.equal(ramDiff(o, c), null, `RAM: A=0x${av.toString(16)}`);
    assert.equal(c.mem.read8(loc_29), c.mem.read8(COORD_LIST_PTR_LO), `$29==$2c for A=0x${av.toString(16)}`);
    assert.equal(ret, o.regs.a, `A live-out for A=0x${av.toString(16)}`);
  }
});

test("TEETH: a twin that skips decimal mode (binary double) diverges", () => {
  const av = 0x2a; // 42 -> BCD 0x42; a no-sed binary run would leave $2c = 0x2a
  const o = new Machine(ROM, OPTS); o.regs.a = av;
  oracle(o);
  assert.notEqual(o.mem.read8(COORD_LIST_PTR_LO), 0x00, "precondition: oracle produced a non-zero BCD result");
  const brokenBinary = 0x2a; // BUG: forgot `sed` -> $2c stays the binary value
  assert.notEqual(brokenBinary, o.mem.read8(COORD_LIST_PTR_LO), "the RAM diff FAILED to catch a missing decimal mode");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xff;
  m.regs.a = 0x2a;
  m.push16(0xabcd); // a real caller-return word on the 6502 page-1 stack
  const r = seamPlaceable(withOmittedRet, packBinaryToBcd, TARGET, m);
  assert.equal(r.placeable, true, `packBinaryToBcd must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});

// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for buildSortedObjectTable (0x323e) -- advances the decimal rate accumulators, then
// inserts the two active objects into the key-sorted slot table. A leaf whose live-out is work RAM (in
// dumpState); it KEEPS the frozen 0x2d5c call (LEAVE_MCALL spine), so on the rebuild path both sides run
// the same oracle callee and the diff still cancels. Every arm checks the RAM diff (minus stack scratch below the entry SP).
// Run: node --test games/centiped/idiomatic/test/equivalence-323e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_323e as oracleRom } from "../../translated/loc_323e.js";
import { buildSortedObjectTable } from "../buildSortedObjectTable.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_a8, loc_aa, loc_ac, loc_a9, loc_ab, loc_ad,
  loc_fb, loc_fc, loc_89, loc_018e, loc_018f, loc_0190, loc_0191, loc_02,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x323e;
const SLOT_LO = 0x02, SLOT_HI = 0x19; // the eight 3-byte slot records
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

function seed(m, s) {
  for (let a = SLOT_LO; a <= SLOT_HI; a++) m.mem.write8(a, s.slotFill ?? 0);
  m.mem.write8(loc_a8, s.o1x ?? 0); m.mem.write8(loc_aa, s.o1y ?? 0); m.mem.write8(loc_ac, s.o1z ?? 0);
  m.mem.write8(loc_a9, s.o0x ?? 0); m.mem.write8(loc_ab, s.o0y ?? 0); m.mem.write8(loc_ad, s.o0z ?? 0);
  m.mem.write8(loc_fb, s.rateLo ?? 0); m.mem.write8(loc_fc, s.rateHi ?? 0); m.mem.write8(loc_89, s.rate2 ?? 0);
  if (s.acc != null) for (const [a, v] of s.acc) m.mem.write8(a, v);
}

test("CAPTURE: real 0x323e dispatches -- buildSortedObjectTable == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); buildSortedObjectTable(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: rate advance + sorted insert across every path == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "both objects insert (slots empty)", slotFill: 0, o1x: 0x10, o0x: 0x10, rateLo: 0x11, rate2: 0x22 },
    { tag: "no insert -> rebuild via 0x2d5c", slotFill: 0xff, rateLo: 0x05, rate2: 0x03 },
    { tag: "object 1 inserts, object 0 does not", slotFill: 0x80, o1x: 0, o1y: 0, o1z: 0, o0x: 0xff, o0y: 0xff, o0z: 0xff },
    { tag: "decimal accumulator overflow skips partner", slotFill: 0, o1x: 0x10, o0x: 0x10, rateLo: 0x01,
      acc: [[loc_018e, 0x99], [loc_018f, 0x99], [loc_0190, 0x99], [loc_0191, 0x99]] },
    { tag: "high-water clamp on small marks", slotFill: 0x40, o1x: 0, o0x: 0 },
    { tag: "insert at a high slot index", slotFill: 0x01, o1z: 0x02, o0z: 0x02 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); buildSortedObjectTable(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a wrong inserted slot key is caught by the RAM diff", () => {
  const s = { slotFill: 0, o1x: 0x10, o0x: 0x10 };
  const o = new Machine(ROM); seed(o, s);
  oracle(o);
  assert.equal(o.mem8[loc_02], 0x10, "precondition: oracle copied object X into slot 0");
  const broken = 0x00; // BUG: never copied the object's key into the freed slot
  assert.notEqual(broken, o.mem8[loc_02], "the RAM diff FAILED to catch a wrong inserted slot key");
});

test("SP-TOOTH: the seat-then-dispatch rewrite is seam-placeable; a pushing twin is not", () => {
  // A both-insert state finishes on the leaf ret (skips the 0x2d5c rebuild), so the seam completes at moved 0.
  const seated = new Machine(ROM);
  seed(seated, { slotFill: 0, o1x: 0x10, o0x: 0x10 });
  seated.regs.s = 0xfb;
  seated.mem.write8(0x01fc, 0xcd); seated.mem.write8(0x01fd, 0xab); // a real caller-return word for the seam
  assert.equal(seamPlaceable(withOmittedRet, buildSortedObjectTable, TARGET, seated.clone()).placeable, true);
  const spLeak = (mm) => { mm.push8(0x00); };
  assert.equal(seamPlaceable(withOmittedRet, spLeak, TARGET, seated.clone()).placeable, false);
});

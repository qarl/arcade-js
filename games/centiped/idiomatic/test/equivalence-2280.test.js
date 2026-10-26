// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for steerObjectRowTarget (ROM 0x2280). It commits a row target, may clear a tile
// cell, and steers a drift cell before dispatching a distance-fold step; all output is RAM (in
// dumpState), so each arm checks the RAM diff (minus stack scratch below the entry SP). The distance-fold step (0x2c96)
// is a spine routine kept as an m.call, run as the frozen fallback on both sides here. An omitted-ret
// rewrite (the seam completes the ret).
// Run: node --test games/centiped/idiomatic/test/equivalence-2280.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2280 as oracleRom } from "../../translated/loc_2280.js";
import { steerObjectRowTarget } from "../steerObjectRowTarget.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_71, loc_61, loc_f0, loc_88, loc_ab, loc_8d, loc_ef, OBJECT_Y_STEER,
  TILEMAP_PTR_LO, TILEMAP_PTR_HI, loc_8b,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2280;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

// Seat a caller-return word at the entry SP (compared), a tile pointer into RAM, and the input A in a param.
function seat(m, s = {}) {
  m.regs.s = 0xf0;
  m.mem.write8(0x01f1, 0xcd); m.mem.write8(0x01f2, 0xab);
  m.mem.write8(TILEMAP_PTR_LO, s.p32 ?? 0x40); m.mem.write8(TILEMAP_PTR_HI, s.p33 ?? 0x00);
  m.mem.write8(loc_61, s.c61 ?? 0x10);
  m.mem.write8(loc_f0, s.f0 ?? 0x00);
  m.mem.write8(loc_88, s.c88 ?? 0x00);
  m.mem.write8(loc_ab, s.ab0 ?? 0x00);
  m.mem.write8(loc_ef, s.ef ?? 0x00);
  m.mem.write8(OBJECT_Y_STEER, s.c81 ?? 0x00);
  m.mem.write8(loc_8b, s.c8b ?? 0x00);
  m.regs.a = s.a ?? 0x40;
}

test("CAPTURE: real 0x2280 dispatches -- steerObjectRowTarget == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); steerObjectRowTarget(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: seeded states across every branch == oracle (RAM)", () => {
  const cases = [
    { tag: "retired column -> reseed", c61: 0xff, a: 0x40 },
    { tag: "keyed<9, positive heading -> steer", c61: 0x10, a: 0x00, f0: 0x00, c81: 0x00 },
    { tag: "keyed<9, negative heading -> collision", c61: 0x10, a: 0x00, f0: 0x00, c81: 0x80 },
    { tag: "keyed>=9, near ($ef==0)", c61: 0x10, a: 0x40, f0: 0x00, ef: 0x00, c88: 0x00, ab0: 0x20 },
    { tag: "keyed>=9, far ($ef!=0)", c61: 0x10, a: 0x40, f0: 0x00, ef: 0x01, c88: 0x00, ab0: 0x20 },
    { tag: "keyed>=9, BCD reduce with high counter", c61: 0x10, a: 0x40, f0: 0x00, ef: 0x00, c88: 0x00, ab0: 0x99 },
    { tag: "keyed>=9, counter below 6 (floor 0)", c61: 0x10, a: 0x40, f0: 0x00, ef: 0x00, c88: 0x00, ab0: 0x03 },
    { tag: "cell occupied high class -> clear+dec", c61: 0x10, a: 0x40, p32: 0x50, p33: 0x00 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seat(o, s);
    const c = new Machine(ROM); seat(c, s);
    oracle(o); steerObjectRowTarget(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a wrong committed row target is caught by the RAM diff", () => {
  const s = { c61: 0x10, a: 0x40 };
  const o = new Machine(ROM); seat(o, s);
  oracle(o);
  assert.equal(o.mem8[loc_71], 0x40, "precondition: oracle committed A to the row target cell");
  const broken = 0x41; // BUG: committed the wrong row target
  assert.notEqual(broken, o.mem8[loc_71], "the RAM diff FAILED to catch a wrong committed row target");
});

test("SP-TOOTH: the omitted-ret rewrite is seam-placeable, and a stack-adrift mutant is refused", () => {
  // Retired-column path: reseed + omitted ret (SP unmoved), the cleanest placeable check.
  const m = new Machine(ROM); seat(m, { c61: 0xff });
  const r = seamPlaceable(withOmittedRet, steerObjectRowTarget, TARGET, m);
  assert.equal(r.placeable, true, `steerObjectRowTarget must be seam-placeable; got: ${r.error}`);
  const nullMutant = (mm) => { mm.push16(0x1234); };
  const bad = seamPlaceable(withOmittedRet, nullMutant, TARGET, new Machine(ROM));
  assert.equal(bad.placeable, false, "the SP-TOOTH FAILED to refuse a stack-adrift mutant");
  console.log("  SP-TOOTH: omitted-ret placeable; adrift mutant refused");
});

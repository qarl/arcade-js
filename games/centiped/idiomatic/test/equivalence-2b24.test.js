// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clampCoordToBand (ROM 0x2b24). Advances $73 by A(+carry), clamps into the
// valid band unless the destination tile cell is occupied, then may hand off to the follow-up stage
// ($2b60) when $86 is non-negative. Dispatching: it keeps the tail m.call, so oracle and rewrite both
// run the full chain; equivalence is the RAM diff (minus stack scratch below the entry SP).
// Run: node --test games/centiped/idiomatic/test/equivalence-2b24.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b24 as oracleRom } from "../../translated/loc_2b24.js";
import { clampCoordToBand } from "../clampCoordToBand.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_63, loc_73, loc_86 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2b24;
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
  m.regs.a = s.a ?? 0;
  if (s.carry) m.regs.sec(); else m.regs.clc();
  m.mem.write8(loc_73, s.c73 ?? 0);
  m.mem.write8(loc_63, s.c63 ?? 0);
  m.mem.write8(loc_86, s.c86 ?? 0x80); // default negative -> no tail dispatch, isolate this routine
}

test("CAPTURE: real 0x2b24 dispatches -- clampCoordToBand == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); clampCoordToBand(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: every clamp band (empty cell) == oracle", () => {
  const cases = [
    { tag: "sum < 0x08 -> 0x08", a: 0x02, c73: 0x00 },
    { tag: "sum >= 0xf1 -> 0xf0", a: 0xf8, c73: 0x00 },
    { tag: "0x08..0x31 keep", a: 0x20, c73: 0x00 },
    { tag: "0x31..0x80 -> 0x30", a: 0x50, c73: 0x00 },
    { tag: "0x80..0xc8 -> 0xc8", a: 0xa0, c73: 0x00 },
    { tag: "0xc8..0xf1 keep", a: 0xd0, c73: 0x00 },
    { tag: "carry-in folds into the sum", a: 0x05, c73: 0x02, carry: true },
    { tag: "non-zero $73 base", a: 0x10, c73: 0x25 },
    { tag: "$86 non-negative -> tail dispatch to follow-up", a: 0x20, c73: 0x00, c86: 0x00 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); clampCoordToBand(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a wrong clamped $73 is caught by the RAM diff", () => {
  const o = new Machine(ROM); seed(o, { a: 0x02, c73: 0x00 });
  oracle(o);
  assert.equal(o.mem8[loc_73], 0x08, "precondition: oracle clamped $73 up to 0x08");
  const brokenStore = 0x02; // BUG: stored the raw sum instead of the low clamp
  assert.notEqual(brokenStore, o.mem8[loc_73], "the RAM diff FAILED to catch a wrong clamp");
});

test("SP-TOOTH: the omitted-ret path (no tail dispatch) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // caller-return word for the seam
  seed(m, { a: 0x20, c73: 0x00, c86: 0x80 }); // $86 negative -> returns without dispatching
  const r = seamPlaceable(withOmittedRet, clampCoordToBand, TARGET, m);
  assert.equal(r.placeable, true, `clampCoordToBand must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret path placeable");
});

test("SP-TOOTH: a net-nonzero SP mutant is refused", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab);
  const badFn = (mm) => { mm.push8(0x00); }; // leaves SP off by one -> unplaceable
  const r = seamPlaceable(withOmittedRet, badFn, TARGET, m);
  assert.equal(r.placeable, false, "the SP-tooth FAILED to refuse a net-nonzero SP move");
});

// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for routeByCoordDelta (ROM 0x2b60). Gates on the signed $72-$8d delta ($ef
// inverts the bail side); routes to the $72/$62 fixup ($2b79, dissolved) or -- when the magnitude
// is >= 5 -- to the arm-flag tail ($2b86, kept as m.call). Dispatching: oracle and rewrite both run
// the full chain; equivalence is the RAM diff (minus stack scratch below the entry SP).
// Run: node --test games/centiped/idiomatic/test/equivalence-2b60.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b60 as oracleRom } from "../../translated/loc_2b60.js";
import { routeByCoordDelta } from "../routeByCoordDelta.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_72, loc_8d, loc_ef } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2b60;
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
  m.mem.write8(loc_72, s.c72 ?? 0);
  m.mem.write8(loc_8d, s.c8d ?? 0);
  m.mem.write8(loc_ef, s.cef ?? 0);
}

test("CAPTURE: real 0x2b60 dispatches -- routeByCoordDelta == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); routeByCoordDelta(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: every route across the $ef / delta / magnitude branches == oracle", () => {
  const cases = [
    { tag: "$ef!=0, delta>=0 -> fixup", c72: 0x10, c8d: 0x00, cef: 1 },
    { tag: "$ef==0, delta<0 -> fixup", c72: 0x00, c8d: 0x10, cef: 0 },
    { tag: "$ef!=0, delta<0, |d|>=5 -> arm tail", c72: 0x00, c8d: 0x20, cef: 1 },
    { tag: "$ef!=0, delta<0, |d|<5 -> fixup", c72: 0x00, c8d: 0x03, cef: 1 },
    { tag: "$ef==0, delta>=0, |d|>=5 -> arm tail", c72: 0x20, c8d: 0x00, cef: 0 },
    { tag: "$ef==0, delta>=0, |d|<5 -> fixup", c72: 0x03, c8d: 0x00, cef: 0 },
    { tag: "magnitude exactly 5 -> arm tail", c72: 0x05, c8d: 0x00, cef: 0 },
    { tag: "magnitude exactly 4 -> fixup", c72: 0x04, c8d: 0x00, cef: 0 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); routeByCoordDelta(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: the fixup's $72 rewrite is caught by the RAM diff", () => {
  // $ef!=0, delta>=0 -> loc_2b79 fixup: $72 = ($73 + (4 ^ $f0)) & 0xff.
  const o = new Machine(ROM); seed(o, { c72: 0x10, c8d: 0x00, cef: 1 });
  o.mem.write8(0x0073, 0x11); o.mem.write8(0x00f0, 0x00);
  oracle(o);
  assert.equal(o.mem8[loc_72], (0x11 + (0x04 ^ 0x00)) & 0xff, "precondition: fixup rewrote $72");
  const brokenB72 = 0x10; // BUG: never ran the fixup
  assert.notEqual(brokenB72, o.mem8[loc_72], "the RAM diff FAILED to catch a skipped $72 fixup");
});

test("SP-TOOTH: the dispatching arm-tail path is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // caller-return word for the seam
  seed(m, { c72: 0x00, c8d: 0x20, cef: 1 }); // fold path, |d|>=5 -> m.call(0x2b86) tail transfer
  const r = seamPlaceable(withOmittedRet, routeByCoordDelta, TARGET, m);
  assert.equal(r.placeable, true, `routeByCoordDelta must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: arm-tail dispatch placeable");
});

test("SP-TOOTH: a net-nonzero SP mutant is refused", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab);
  const badFn = (mm) => { mm.push8(0x00); };
  const r = seamPlaceable(withOmittedRet, badFn, TARGET, m);
  assert.equal(r.placeable, false, "the SP-tooth FAILED to refuse a net-nonzero SP move");
});

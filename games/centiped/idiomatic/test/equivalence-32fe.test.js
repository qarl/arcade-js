// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for plotObjectCoordinates (0x32fe) -- prints an object's coordinate bytes as decimal
// digits through the frozen two-digit plotter. A DISPATCHING rewrite: it KEEPS the 0x384f calls (LEAVE_MCALL
// spine, register+carry bridged per R37) and TAIL-dispatches the last one, so the seam places it at moved +2.
// The plotted output lands in video RAM (in dumpState); every arm checks the RAM diff (minus stack scratch below the entry SP).
// Run: node --test games/centiped/idiomatic/test/equivalence-32fe.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_32fe as oracleRom } from "../../translated/loc_32fe.js";
import { plotObjectCoordinates } from "../plotObjectCoordinates.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_91, loc_92, loc_f5, loc_f7,
  loc_ac, loc_aa, loc_a8, loc_ad, loc_ab, loc_a9, loc_04, loc_03, loc_02, loc_89,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x32fe;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// The flip masks steer the cursor; keep the high mask in [0,3] so every group's cursor stays in writable
// video/object RAM (below 0x0800) rather than faulting on a decode hole.
function seed(m, s) {
  m.mem.write8(loc_89, s.rows ?? 0);
  m.mem.write8(loc_f5, s.f5 ?? 0); m.mem.write8(loc_f7, s.f7 ?? 0);
  m.mem.write8(loc_ac, s.ac ?? 0); m.mem.write8(loc_aa, s.aa ?? 0); m.mem.write8(loc_a8, s.a8 ?? 0);
  m.mem.write8(loc_ad, s.ad ?? 0); m.mem.write8(loc_ab, s.ab ?? 0); m.mem.write8(loc_a9, s.a9 ?? 0);
  m.mem.write8(loc_04, s.c4 ?? 0); m.mem.write8(loc_03, s.c3 ?? 0); m.mem.write8(loc_02, s.c2 ?? 0);
}

test("CAPTURE: real 0x32fe dispatches -- plotObjectCoordinates == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); plotObjectCoordinates(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: high/optional-middle/low plot groups == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "middle group runs (rows != 1)", rows: 0, ac: 0x12, aa: 0x34, a8: 0x56 },
    { tag: "middle group skipped (rows == 1)", rows: 1, ac: 0x12, c4: 0x99, c3: 0x88, c2: 0x77 },
    { tag: "flip masks steer the cursor", rows: 2, f5: 0x02, f7: 0x01, ac: 0x12, ad: 0x34, aa: 0x9a },
    // NB: no $f7 flip here -- with $f7=2 the low group's page becomes 0x07 and the +0x20 cursor stride
    // overflows into the unmapped 0x08xx hole (the oracle itself faults), so it stays 0 to keep the cursor
    // in writable video/object RAM. The middle group still runs ($89-1 != 0) with wide coord bytes.
    { tag: "middle group with wide coords", rows: 3, ac: 0x0f, aa: 0xf0, a8: 0x55, ad: 0x11, ab: 0x22, a9: 0x33 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); plotObjectCoordinates(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a one-off in the final cursor is caught by the RAM diff", () => {
  const s = { rows: 0, ac: 0x12, aa: 0x34, a8: 0x56 };
  const o = new Machine(ROM); seed(o, s);
  const c = new Machine(ROM); seed(c, s);
  const broken = (m) => { plotObjectCoordinates(m); m.mem8[loc_91] = (m.mem8[loc_91] + 1) & 0xff; };
  oracle(o); broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a wrong final cursor");
  assert.equal(d.addr, loc_91 & 0xffff);
});

test("SP-TOOTH: the tail-dispatch (moved +2) is seam-placeable; a pushing twin is not", () => {
  const seated = new Machine(ROM);
  seed(seated, { rows: 0 }); // zero coords/masks -> cursor stays in video RAM through the whole chain
  seated.regs.s = 0xfb;
  seated.mem.write8(0x01fc, 0xcd); seated.mem.write8(0x01fd, 0xab); // a real caller-return word for the seam
  assert.equal(seamPlaceable(withOmittedRet, plotObjectCoordinates, TARGET, seated.clone()).placeable, true);
  const spLeak = (mm) => { mm.push8(0x00); };
  assert.equal(seamPlaceable(withOmittedRet, spLeak, TARGET, seated.clone()).placeable, false);
});

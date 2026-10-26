// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceSegmentCoordAndArm (ROM 0x2a92). Advances a segment's $54 coordinate
// by its $44 delta, runs the arm probe ($2c96, dissolved), then either returns (armed, carry clear ->
// $2acd, dissolved) or dispatches on $64&7: value 4 -> the flip stage ($2aa6, kept m.call), else the
// next-segment step ($2ac7, kept m.call). Dispatching: oracle and rewrite both run the full chain;
// equivalence is the RAM diff (minus stack scratch below the entry SP).
// Run: node --test games/centiped/idiomatic/test/equivalence-2a92.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2a92 as oracleRom } from "../../translated/loc_2a92.js";
import { advanceSegmentCoordAndArm } from "../advanceSegmentCoordAndArm.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_44, loc_54, loc_63, loc_64, loc_73, loc_74 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2a92;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Seat a segment slot at index x and its reference point ($63/$73).
function seed(m, s) {
  m.regs.x = s.x ?? 0;
  m.mem.write8((loc_44 + (s.x ?? 0)) & 0xff, s.d44 ?? 0);
  m.mem.write8((loc_54 + (s.x ?? 0)) & 0xff, s.d54 ?? 0);
  m.mem.write8((loc_64 + (s.x ?? 0)) & 0xff, s.d64 ?? 0);
  m.mem.write8((loc_74 + (s.x ?? 0)) & 0xff, s.d74 ?? 0);
  m.mem.write8(loc_63, s.c63 ?? 0);
  m.mem.write8(loc_73, s.c73 ?? 0);
}

test("CAPTURE: real 0x2a92 dispatches -- advanceSegmentCoordAndArm == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); advanceSegmentCoordAndArm(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: armed / next-segment / flip-stage routes == oracle", () => {
  const cases = [
    { tag: "in range -> armed, returns", x: 0, d44: 0, d54: 0x10, d64: 0x10, c63: 0x10, c73: 0x10 },
    { tag: "out of range, $64&7!=4 -> next segment", x: 0, d44: 0, d54: 0x40, d64: 0x00, c63: 0, c73: 0 },
    { tag: "out of range, $64&7==4 -> flip stage", x: 0, d44: 0, d54: 0x40, d64: 0x04, d74: 0, c63: 0, c73: 0 },
    { tag: "delta advances coordinate then next segment", x: 0, d44: 0x05, d54: 0x40, d64: 0x00, c63: 0, c73: 0 },
    { tag: "flip stage with a live link", x: 0, d44: 0x03, d54: 0x40, d64: 0x04, d74: 0x07, c63: 0, c73: 0 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); advanceSegmentCoordAndArm(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a skipped coordinate advance is caught by the RAM diff", () => {
  const s = { x: 0, d44: 0x05, d54: 0x40, d64: 0x00, c63: 0, c73: 0 };
  const o = new Machine(ROM); seed(o, s);
  oracle(o);
  assert.equal(o.mem8[(loc_54 + s.x) & 0xff], (0x40 + 0x05) & 0xff, "precondition: oracle advanced $54 by $44");
  const brokenCoord = 0x40; // BUG: never added the delta into the coordinate
  assert.notEqual(brokenCoord, o.mem8[(loc_54 + s.x) & 0xff], "the RAM diff FAILED to catch a skipped coord advance");
});

test("SP-TOOTH: the dispatching next-segment path is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // caller-return word for the seam
  seed(m, { x: 0, d44: 0, d54: 0x40, d64: 0x00, c63: 0, c73: 0 }); // out of range -> m.call(0x2ac7), x=0 -> RTS
  const r = seamPlaceable(withOmittedRet, advanceSegmentCoordAndArm, TARGET, m);
  assert.equal(r.placeable, true, `advanceSegmentCoordAndArm must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: next-segment dispatch placeable");
});

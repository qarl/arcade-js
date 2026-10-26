// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for reverseSegmentDeltaAndStepCoord (ROM 0x2aa6). Negates the segment delta
// ($44,X) through the two's-complement helper ($382d, dissolved), and -- when the neighbour link
// ($74,X) is clear -- seeds that link and nudges the coordinate ($54,X) by +/-4; then falls through
// to the next-segment step ($2ac7, kept m.call). Dispatching: oracle and rewrite both run the full
// chain; equivalence is the RAM diff (minus stack scratch below the entry SP).
// Run: node --test games/centiped/idiomatic/test/equivalence-2aa6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2aa6 as oracleRom } from "../../translated/loc_2aa6.js";
import { reverseSegmentDeltaAndStepCoord } from "../reverseSegmentDeltaAndStepCoord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_44, loc_54, loc_74 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2aa6;
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
  m.regs.x = s.x ?? 0;
  m.mem.write8((loc_44 + (s.x ?? 0)) & 0xff, s.d44 ?? 0);
  m.mem.write8((loc_54 + (s.x ?? 0)) & 0xff, s.d54 ?? 0);
  m.mem.write8((loc_74 + (s.x ?? 0)) & 0xff, s.d74 ?? 0);
}

test("CAPTURE: real 0x2aa6 dispatches -- reverseSegmentDeltaAndStepCoord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); reverseSegmentDeltaAndStepCoord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: link-set early exit and every flip/step branch == oracle", () => {
  const cases = [
    { tag: "live link -> flip delta, next segment", x: 0, d44: 0x05, d54: 0x40, d74: 0x07 },
    { tag: "clear link, positive delta -> step -4", x: 0, d44: 0x05, d54: 0x40, d74: 0 },
    { tag: "clear link, negative delta -> step +4", x: 0, d44: 0xfc, d54: 0x40, d74: 0 },
    { tag: "clear link, zero delta -> step +4", x: 0, d44: 0x00, d54: 0x40, d74: 0 },
    { tag: "coordinate wrap on -4", x: 0, d44: 0x01, d54: 0x02, d74: 0 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); reverseSegmentDeltaAndStepCoord(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a skipped delta flip is caught by the RAM diff", () => {
  const s = { x: 0, d44: 0x05, d54: 0x40, d74: 0 };
  const o = new Machine(ROM); seed(o, s);
  oracle(o);
  assert.equal(o.mem8[(loc_44 + s.x) & 0xff], (-0x05) & 0xff, "precondition: oracle negated $44");
  const brokenDelta = 0x05; // BUG: never reversed the delta
  assert.notEqual(brokenDelta, o.mem8[(loc_44 + s.x) & 0xff], "the RAM diff FAILED to catch a skipped delta flip");
});

test("SP-TOOTH: the dispatching next-segment tail is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // caller-return word for the seam
  seed(m, { x: 0, d44: 0x05, d54: 0x40, d74: 0 }); // -> m.call(0x2ac7), x=0 -> RTS
  const r = seamPlaceable(withOmittedRet, reverseSegmentDeltaAndStepCoord, TARGET, m);
  assert.equal(r.placeable, true, `reverseSegmentDeltaAndStepCoord must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: next-segment tail placeable");
});

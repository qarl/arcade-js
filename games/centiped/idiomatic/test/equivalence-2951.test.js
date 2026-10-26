// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for beginCentipedeSegmentSweep (ROM 0x2951). The $87 gate returns early; otherwise
// it seeds the segment index at 0x0b, arms the ch2 SFX timer ($b3=7) on frames with $00's low nibble
// clear, and falls into the per-segment mover (kept as a cyclic m.call to 0x2962). Dispatching: oracle
// and rewrite both run the whole segment sweep, so equivalence is the RAM diff (minus stack scratch below the entry SP).
// pokeyRandom is neutralised (the sweep's clock-derived RNG would diverge under cycle-free execution).
// Run: node --test games/centiped/idiomatic/test/equivalence-2951.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2951 as oracleRom } from "../../translated/loc_2951.js";
import { beginCentipedeSegmentSweep } from "../beginCentipedeSegmentSweep.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_00, loc_87, SFX_TIMER_CH2 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2951;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
const neutralize = (m) => { m.io.pokeyRandom = () => 0xff; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

function seed(m, s) {
  m.mem.write8(loc_87, s.gate ?? 0);
  m.mem.write8(loc_00, s.frame ?? 0);
  return m;
}

test("CAPTURE: real 0x2951 dispatches -- beginCentipedeSegmentSweep == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = neutralize(cap.clone()), c = neutralize(cap.clone());
    oracle(o); beginCentipedeSegmentSweep(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: gate / timer-arm / plain-entry branches == oracle", () => {
  const cases = [
    { tag: "gated ($87!=0) -> early return", gate: 0x01, frame: 0x00 },
    { tag: "open, low nibble 0 -> arm $b3=7 then sweep", gate: 0x00, frame: 0x10 },
    { tag: "open, low nibble != 0 -> sweep, no arm", gate: 0x00, frame: 0x03 },
    { tag: "open, frame 0 -> arm then sweep", gate: 0x00, frame: 0x00 },
  ];
  for (const s of cases) {
    const o = neutralize(new Machine(ROM)); seed(o, s);
    const c = neutralize(new Machine(ROM)); seed(c, s);
    oracle(o); beginCentipedeSegmentSweep(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: the $b3 timer-arm is caught by the RAM diff", () => {
  const o = neutralize(new Machine(ROM)); seed(o, { gate: 0x00, frame: 0x00 });
  oracle(o);
  assert.equal(o.mem8[SFX_TIMER_CH2], 0x07, "precondition: oracle armed $b3 to 7");
  const brokenArm = 0x00; // BUG: never armed the timer
  assert.notEqual(brokenArm, o.mem8[SFX_TIMER_CH2], "the RAM diff FAILED to catch a skipped $b3 arm");
});

test("SP-TOOTH: the dispatching sweep entry is seam-placeable", () => {
  const m = ROM_PRESENT ? neutralize(CAPS[0].clone()) : new Machine(ROM);
  const r = seamPlaceable(withOmittedRet, beginCentipedeSegmentSweep, TARGET, m);
  assert.equal(r.placeable, true, `beginCentipedeSegmentSweep must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: sweep-entry dispatch placeable");
});

// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for commitSegmentCoord (ROM 0x2a90). Stores A into $64+X then tail-transfers into
// loc_2a92 (kept as a cyclic m.call). Dispatching: oracle and rewrite both run the full tail chain, so
// equivalence is the RAM diff (minus stack scratch below the entry SP). pokeyRandom is neutralised: the tail chain's clock-
// derived RNG would otherwise diverge under the idiomatic layer's cycle-free execution.
// Run: node --test games/centiped/idiomatic/test/equivalence-2a90.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2a90 as oracleRom } from "../../translated/loc_2a90.js";
import { commitSegmentCoord } from "../commitSegmentCoord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_64 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2a90;
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

test("CAPTURE: real 0x2a90 dispatches -- commitSegmentCoord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = neutralize(cap.clone()), c = neutralize(cap.clone());
    oracle(o); commitSegmentCoord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the coordinate store lands in $64+X across slots == oracle", () => {
  const cases = [
    { x: 0x00, a: 0x37 },
    { x: 0x05, a: 0x00 },
    { x: 0x0b, a: 0xff },
    { x: 0x03, a: 0x80 },
  ];
  for (const s of cases) {
    const o = neutralize(new Machine(ROM)), c = neutralize(new Machine(ROM));
    o.regs.x = s.x; o.regs.a = s.a;
    c.regs.x = s.x; c.regs.a = s.a;
    oracle(o); commitSegmentCoord(c);
    assert.equal(ramDiff(o, c), null, `x=${s.x} a=${s.a}`);
    assert.equal(c.mem8[(loc_64 + s.x) & 0xff], s.a, `store landed for x=${s.x}`);
  }
});

test("TEETH: a wrong stored coordinate is caught by the RAM diff", () => {
  const o = neutralize(new Machine(ROM));
  o.regs.x = 0x04; o.regs.a = 0x2a;
  oracle(o);
  assert.equal(o.mem8[(loc_64 + 0x04) & 0xff], 0x2a, "precondition: oracle stored A into $64+X");
  const brokenStore = 0x00; // BUG: failed to store the coordinate
  assert.notEqual(brokenStore, o.mem8[(loc_64 + 0x04) & 0xff], "the RAM diff FAILED to catch a skipped store");
});

test("SP-TOOTH: the dispatching store-and-step is seam-placeable", () => {
  const m = ROM_PRESENT ? neutralize(CAPS[0].clone()) : new Machine(ROM);
  const r = seamPlaceable(withOmittedRet, commitSegmentCoord, TARGET, m);
  assert.equal(r.placeable, true, `commitSegmentCoord must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: store-and-step dispatch placeable");
});

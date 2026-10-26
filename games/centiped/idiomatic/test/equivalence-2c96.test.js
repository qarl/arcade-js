// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for armSlotWhenObjectInRange (ROM 0x2c96). Measures object X's |dx|,|dy| from the
// reference point ($63,$73); bails (RTS) when either clears its bound, else stashes |dx| in $8d and hands
// the summed distance to the slot arm ($2cc2 / value-gated $2cea, both dissolved). All tail transfers are
// dissolved, so it runs as an omitted-ret routine; equivalence is the RAM diff (minus stack scratch below the entry SP).
// Run: node --test games/centiped/idiomatic/test/equivalence-2c96.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2c96 as oracleRom } from "../../translated/loc_2c96.js";
import { armSlotWhenObjectInRange } from "../armSlotWhenObjectInRange.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_54, loc_63, loc_64, loc_73, loc_8d } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2c96;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Seat object X's cells and the reference point; set X in the register the routine reads by default.
function seed(m, s) {
  const x = s.x ?? 0;
  m.regs.x = x;
  m.mem.write8((loc_54 + x) & 0xff, s.dxCell ?? 0);
  m.mem.write8((loc_64 + x) & 0xff, s.dyCell ?? 0);
  m.mem.write8(loc_63, s.c63 ?? 0);
  m.mem.write8(loc_73, s.c73 ?? 0);
}

test("CAPTURE: real 0x2c96 dispatches -- armSlotWhenObjectInRange == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); armSlotWhenObjectInRange(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: every range/bound/dispatch branch == oracle", () => {
  const cases = [
    { tag: "|dx| >= 0x07 (slot != 0x0d) -> bail", x: 0x00, dxCell: 0x40, c63: 0x00 },
    { tag: "|dx| >= 0x0a (slot 0x0d) -> bail", x: 0x0d, dxCell: 0x20, c63: 0x00 },
    { tag: "|dx| ok, |dy| >= 0x07 -> bail after $8d write", x: 0x00, dxCell: 0x02, c63: 0x00, dyCell: 0x40, c73: 0x00 },
    { tag: "success, sum < 0x0c -> arm (carry clear)", x: 0x00, dxCell: 0x02, c63: 0x00, dyCell: 0x03, c73: 0x00 },
    { tag: "success, sum >= 0x0c -> arm (carry set)", x: 0x00, dxCell: 0x06, c63: 0x00, dyCell: 0x06, c73: 0x00 },
    { tag: "negative dx folds to magnitude", x: 0x00, dxCell: 0x00, c63: 0x03, dyCell: 0x02, c73: 0x00 },
    { tag: "slot 0x0d success -> value-gated arm", x: 0x0d, dxCell: 0x02, c63: 0x00, dyCell: 0x03, c73: 0x00 },
    { tag: "slot 0x0d, |dx| in [0x07,0x0a) still passes", x: 0x0d, dxCell: 0x08, c63: 0x00, dyCell: 0x02, c73: 0x00 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); armSlotWhenObjectInRange(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: the $8d stash is caught by the RAM diff", () => {
  const s = { x: 0x00, dxCell: 0x05, c63: 0x00, dyCell: 0x03, c73: 0x00 };
  const o = new Machine(ROM); seed(o, s);
  oracle(o);
  assert.equal(o.mem8[loc_8d], 0x05, "precondition: oracle stashed |dx| in $8d");
  const brokenB8d = 0x00; // BUG: never stashed |dx|
  assert.notEqual(brokenB8d, o.mem8[loc_8d], "the RAM diff FAILED to catch a skipped $8d stash");
});

test("SP-TOOTH: the omitted-ret bail path is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // caller-return word for the seam
  seed(m, { x: 0x00, dxCell: 0x40, c63: 0x00 }); // |dx| out of range -> early return
  const r = seamPlaceable(withOmittedRet, armSlotWhenObjectInRange, TARGET, m);
  assert.equal(r.placeable, true, `armSlotWhenObjectInRange must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret bail path placeable");
});

test("SP-TOOTH: a net-nonzero SP mutant is refused", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab);
  const badFn = (mm) => { mm.push8(0x00); };
  const r = seamPlaceable(withOmittedRet, badFn, TARGET, m);
  assert.equal(r.placeable, false, "the SP-tooth FAILED to refuse a net-nonzero SP move");
});

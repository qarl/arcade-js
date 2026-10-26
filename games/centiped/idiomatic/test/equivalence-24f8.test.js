// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for decrementSlotAndRedrawBorders (0x24f8) -- decrement the current slot's $a4 timer,
// redraw the two grid side borders, then fall through into the segment/wave reseed chain. A +2 dispatcher:
// one dissolved leaf callee (the border draw) then a tail-transfer into the still-translated reseed spine.
// Run: node --test games/centiped/idiomatic/test/equivalence-24f8.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_24f8 as oracleRom } from "../../translated/loc_24f8.js";
import { decrementSlotAndRedrawBorders } from "../decrementSlotAndRedrawBorders.js";
import { drawGridSideBorders } from "../drawGridSideBorders.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_88, loc_a4, loc_a5, loc_a6, loc_f6, loc_f7, loc_ab, loc_ef, loc_f0 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x24f8;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0x24f8 dispatches -- decrementSlotAndRedrawBorders == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); decrementSlotAndRedrawBorders(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Fresh Machine (poly at origin). Seed the slot index + its timer, the border orientation bytes, and the
// difficulty params the reseed tail consumes.
function seed(m, s) {
  m.mem.write8(loc_88, s.x88 ?? 0);
  m.mem.write8((loc_a4 + (s.x88 ?? 0)) & 0xff, s.a4 ?? 0x05);
  m.mem.write8(loc_a5, s.a5 ?? 0x11);
  m.mem.write8(loc_a6, s.a6 ?? 0x0a);
  m.mem.write8(loc_f6, s.f6 ?? 0);
  m.mem.write8(loc_f7, s.f7 ?? 0);
  m.mem.write8((loc_ab + (s.x88 ?? 0)) & 0xff, s.abVal ?? 0x06);
  m.mem.write8(loc_ef, s.ef ?? 0x11);
  m.mem.write8(loc_f0, s.f0 ?? 0x22);
}

test("CRAFTED: dec $a4,x + border redraw + reseed tail == oracle (RAM -stack)", () => {
  const cases = [
    { x88: 0x00, a4: 0x05 },
    { x88: 0x01, a4: 0x01, a5: 0x33, a6: 0x21 }, // a4 timer at 1 -> wraps to 0xff
    { x88: 0x02, a4: 0x00, f6: 0x0f, f7: 0x03 }, // a4 timer at 0 -> wraps to 0xff, flipped orientation
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); decrementSlotAndRedrawBorders(c);
    assert.equal(ramDiff(o, c), null, `RAM: x88=0x${s.x88.toString(16)} a4=0x${s.a4.toString(16)}`);
  }
});

test("TEETH: a twin that skips the slot-timer decrement diverges from the oracle", () => {
  function decr_broken(m) {
    // BUG: dropped the dec $a4,x
    drawGridSideBorders(m);
    m.step(0x24ff, 3); return m.call(0x24ff);
  }
  const s = { x88: 0x00, a4: 0x05 };
  const o = new Machine(ROM); seed(o, s);
  const c = new Machine(ROM); seed(c, s);
  oracle(o); decr_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the skipped decrement");
});

test("SP-TOOTH: the +2 dispatcher is seam-placeable; an SP-adrift mutant is refused", () => {
  const m = new Machine(ROM); seed(m, { x88: 0x00, a4: 0x05 });
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab);
  const r = seamPlaceable(withOmittedRet, decrementSlotAndRedrawBorders, TARGET, m);
  assert.equal(r.placeable, true, `decrementSlotAndRedrawBorders must be seam-placeable; got: ${r.error}`);

  const m2 = new Machine(ROM); seed(m2, { x88: 0x00, a4: 0x05 });
  m2.regs.s = 0xfb;
  m2.mem.write8(0x01fc, 0xcd); m2.mem.write8(0x01fd, 0xab);
  const mutant = (mm) => { mm.push16(0x24ff); }; // pushes, never dispatches/rets through it -> adrift
  const rm = seamPlaceable(withOmittedRet, mutant, TARGET, m2);
  assert.equal(rm.placeable, false, "the SP-tooth FAILED to refuse an SP-adrift mutant");
  console.log("  SP-TOOTH: +2 dispatcher placeable, adrift mutant refused");
});

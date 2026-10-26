// SPDX-License-Identifier: GPL-3.0-only
// also gates: 0x96c8 advanceListCursorByTwo
// Memory-equivalence for advanceCursorPastPackedRecord + advanceListCursorByTwo (ROM 0x96c7-0x96ca) -- two adjacent $969d dispatch entries
// that advance the vector-list cursor Y by 3 (0x96c7) or 2 (0x96c8). No RAM write, so the RAM diff is
// vacuously null; the contract is the single register live-out Y. Both are leaves: they omit the ROM ret
// and the seam completes them, so the arms compare RAM (-stack) + Y. No POKEY/clock read.
// Run: node --test games/tempest/idiomatic/test/equivalence-96c7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_96c7, loc_96c8 } from "../../translated/loc_96c7.js";
import { advanceCursorPastPackedRecord, advanceListCursorByTwo } from "../advanceCursorPastPackedRecord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const rd = (f) => (existsSync(new URL(f, ROM_DIR)) ? new Uint8Array(readFileSync(new URL(f, ROM_DIR))) : null);
const ROM = rd("maincpu.bin");
const opt = (f) => rd(f);
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const ROM_PRESENT = ROM !== null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const oracle7 = atEntry(loc_96c7);
const oracle8 = atEntry(loc_96c8);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(addr, oracleFn, K, maxFrames) {
  const caps = [];
  const snap = new Map([[addr, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracleFn(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any gap throw */ }
  return caps;
}
const CAPS7 = ROM_PRESENT ? captureDispatches(0x96c7, oracle7, 16, 2000) : [];
const CAPS8 = ROM_PRESENT ? captureDispatches(0x96c8, oracle8, 16, 2000) : [];

test("CAPTURE: real dispatches -- advanceCursorPastPackedRecord/96c8 == oracle in RAM (-stack) and Y", () => {
  for (const cap of CAPS7) {
    const o = cap.clone(), c = cap.clone();
    oracle7(o); advanceCursorPastPackedRecord(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.y, o.regs.y, "0x96c7 Y live-out matches the oracle");
  }
  for (const cap of CAPS8) {
    const o = cap.clone(), c = cap.clone();
    oracle8(o); advanceListCursorByTwo(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.y, o.regs.y, "0x96c8 Y live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS7.length}/${CAPS8.length} dispatch(es) checked`);
});

test("CRAFTED: advanceCursorPastPackedRecord advances Y by 3, advanceListCursorByTwo by 2 (8-bit wrap)", () => {
  const ys = [0x00, 0x05, 0x7f, 0xfe, 0xff];
  for (const y of ys) {
    const o7 = new Machine(ROM, OPTS); o7.regs.y = y;
    const c7 = new Machine(ROM, OPTS); c7.regs.y = y;
    oracle7(o7); const r7 = advanceCursorPastPackedRecord(c7);
    assert.equal(ramDiff(o7, c7), null, `96c7 no RAM: y=${y}`);
    assert.equal(c7.regs.y, o7.regs.y, `96c7 Y matches oracle: y=${y}`);
    assert.equal(r7, o7.regs.y, `96c7 return == Y: y=${y}`);

    const o8 = new Machine(ROM, OPTS); o8.regs.y = y;
    const c8 = new Machine(ROM, OPTS); c8.regs.y = y;
    oracle8(o8); const r8 = advanceListCursorByTwo(c8);
    assert.equal(ramDiff(o8, c8), null, `96c8 no RAM: y=${y}`);
    assert.equal(c8.regs.y, o8.regs.y, `96c8 Y matches oracle: y=${y}`);
    assert.equal(r8, o8.regs.y, `96c8 return == Y: y=${y}`);
  }
});

test("TEETH: a twin that uses the wrong stride diverges in Y", () => {
  const o = new Machine(ROM, OPTS); o.regs.y = 0x10; oracle7(o); // 0x96c7 -> +3 -> 0x13
  const brokenY = (0x10 + 2) & 0xff; // BUG: applied the 0x96c8 stride (+2 -> 0x12)
  assert.notEqual(brokenY, o.regs.y, "the Y live-out check FAILED to catch the wrong stride");
});

test("SP-TOOTH: both omitted-ret entries (moved 0) are seam-placeable", () => {
  for (const [fn, addr] of [[advanceCursorPastPackedRecord, 0x96c7], [advanceListCursorByTwo, 0x96c8]]) {
    const m = new Machine(ROM, OPTS);
    m.regs.y = 0;
    m.regs.s = 0xff;
    m.push16(0xabcd);
    const r = seamPlaceable(withOmittedRet, fn, addr, m);
    assert.equal(r.placeable, true, `0x${addr.toString(16)} must be seam-placeable; got: ${r.error}`);
  }
  console.log("  SP-TOOTH: both entries placeable");
});

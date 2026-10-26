// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceAllSegmentColumns (ROM 0x335e) -- the strip entry that preloads the column
// cursor to 2 and tail-dispatches into the per-column advance (0x3360). Its whole observable effect is that
// of advanceSegmentColumns with X=2, so both arms compare the full RAM (minus stack) after the chain. The
// CAPTURE arm replays every real boot dispatch; the CRAFTED arm seeds the segment/timer/threshold cells the
// chain touches; TEETH proves the RAM diff catches a wrong column preload; the SP-tooth proves the rewrite
// (an SP-neutral tail-dispatch) is seam-placeable and a pushing twin is not.
// Run: node --test games/centiped/idiomatic/test/equivalence-335e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_335e as oracleRom } from "../../translated/loc_335e.js";
import { advanceAllSegmentColumns } from "../advanceAllSegmentColumns.js";
import { advanceSegmentColumns } from "../advanceSegmentColumns.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_c5, SEGMENT_MOVE_ACCUM_B, SEGMENT_MOVE_ACCUM, SEGMENT_ROW_CROSS_COUNT, SEGMENT_COL_LIFE_TIMER, SEGMENT_COL_BODY, SEGMENT_RELOAD_TIMER, loc_d3, SEGMENT_MOVE_FRAME_COUNTER } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x335e;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(48, 2500) : [];

// Seat the cells the 0x3360 chain reads/writes plus the IN1 control port; X is irrelevant (the entry
// forces the last-column cursor).
function seed({ in1 = 0xff, d2 = 0x00, d3 = 0x00, d4 = 0x00, c9 = 0x00, ca = 0x00, cb = 0x00, cf = [0, 0, 0], cc = [0, 0, 0], c5 = [0, 0, 0] }) {
  const m = new Machine(ROM);
  m.io.in1 = in1 & 0xff;
  m.mem.write8(SEGMENT_RELOAD_TIMER, d2 & 0xff);
  m.mem.write8(loc_d3, d3 & 0xff);
  m.mem.write8(SEGMENT_MOVE_FRAME_COUNTER, d4 & 0xff);
  m.mem.write8(SEGMENT_MOVE_ACCUM_B, c9 & 0xff);
  m.mem.write8(SEGMENT_MOVE_ACCUM, ca & 0xff);
  m.mem.write8(SEGMENT_ROW_CROSS_COUNT, cb & 0xff);
  for (let i = 0; i < 3; i++) {
    m.mem.write8((SEGMENT_COL_BODY + i) & 0xff, cf[i] & 0xff);
    m.mem.write8((SEGMENT_COL_LIFE_TIMER + i) & 0xff, cc[i] & 0xff);
    m.mem.write8((loc_c5 + i) & 0xff, c5[i] & 0xff);
  }
  return m;
}

test("CAPTURE: real 0x335e dispatches -- advanceAllSegmentColumns == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "no 0x335e dispatches captured");
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); advanceAllSegmentColumns(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: representative control / timer / threshold paths match the oracle", () => {
  const cases = [
    { name: "control-clear/idle", in1: 0x10, d3: 0x00, cf: [0x05, 0x0a, 0x1c], cc: [0x00, 0x00, 0x00] },
    { name: "control-set/wrap", in1: 0xff, d3: 0x0c, cf: [0x10, 0x1b, 0x02], cc: [0x03, 0x00, 0x05] },
    { name: "reload-running/blank", in1: 0x00, d2: 0x40, d3: 0x00, cf: [0x07, 0x07, 0x07], cc: [0x02, 0x02, 0x02] },
    { name: "life-expiry/accumulate", in1: 0x10, d3: 0x0c, cf: [0x05, 0x05, 0x05], cc: [0x01, 0x01, 0x01], c9: 0x20, ca: 0x20 },
    { name: "threshold-commit", in1: 0x10, d3: 0x60, cf: [0x03, 0x03, 0x03], cc: [0x01, 0x01, 0x01], ca: 0xf0, cb: 0x01 },
    { name: "threshold-borrow", in1: 0x10, d3: 0x00, cf: [0x03, 0x03, 0x03], cc: [0x01, 0x01, 0x01], ca: 0x00 },
  ];
  for (const cs of cases) {
    const o = seed(cs), c = seed(cs);
    oracle(o); advanceAllSegmentColumns(c);
    assert.equal(ramDiff(o, c), null, cs.name);
  }
});

test("TEETH: a wrong column preload is caught by the RAM diff", () => {
  // The entry MUST start the walk at column 2; a twin that starts at column 1 skips a column and diverges.
  const spec = { in1: 0x10, d3: 0x0c, cf: [0x05, 0x05, 0x05], cc: [0x01, 0x01, 0x01], c9: 0x20, ca: 0x20 };
  const broken = (m) => advanceSegmentColumns(m, 1); // BUG: preloads column 1, not 2
  const o = seed(spec), c = seed(spec);
  oracle(o); broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a wrong column preload");
});

test("SP-TOOTH: the SP-neutral tail-dispatch is seam-placeable; a pushing twin is not", () => {
  const entry = CAPS[0].clone();
  const r = seamPlaceable(withOmittedRet, advanceAllSegmentColumns, TARGET, entry);
  assert.equal(r.placeable, true, `advanceAllSegmentColumns must be seam-placeable; got: ${r.error}`);
  const mutant = (m) => { m.push16(0xffff); return advanceAllSegmentColumns(m); };
  const r2 = seamPlaceable(withOmittedRet, mutant, TARGET, CAPS[0].clone());
  assert.equal(r2.placeable, false, "the SP-tooth FAILED to refuse an SP-adrift mutant");
  console.log("  SP-TOOTH: SP-neutral tail-dispatch placeable; adrift mutant refused");
});

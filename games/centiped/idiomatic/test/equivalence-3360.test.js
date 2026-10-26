// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceSegmentColumns (ROM 0x3360) -- the per-column centipede-body advance that
// steps SEGMENT_COL_BODY,X, runs the SEGMENT_RELOAD_TIMER / SEGMENT_COL_LIFE_TIMER,X timers, folds a row delta into the SEGMENT_MOVE_ACCUM_B/SEGMENT_MOVE_ACCUM accumulator
// and, after the last column, subtracts the SEGMENT_ROW_THRESHOLD_TABLE,Y threshold before handing off to
// stepPhasedCountersAndWrapCells (the loc_341b tail). CAPTURE replays every real boot dispatch; a
// deterministic fuzz plus hand-crafted cases exercise the control-clear/set, timer-expiry and threshold
// paths; TEETH proves the RAM diff catches a one-off in the accumulator; the SP-tooth proves the rewrite
// (which tail-calls an idiomatic callee, SP unmoved) is seam-placeable and a pushing twin is not.
// Run: node --test games/centiped/idiomatic/test/equivalence-3360.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3360 as oracleRom } from "../../translated/loc_3360.js";
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

const TARGET = 0x3360;
const IN1 = 0x0c01;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(48, 2500) : [];

// Seat the cells the routine reads/writes plus the IN1 port and the X column cursor.
function seed({ x = 0x02, in1 = 0xff, d2 = 0x00, d3 = 0x00, d4 = 0x00, c9 = 0x00, ca = 0x00, cb = 0x00, cf = [0, 0, 0], cc = [0, 0, 0], c5 = [0, 0, 0] }) {
  const m = new Machine(ROM);
  m.io.in1 = in1 & 0xff;
  m.regs.x = x & 0xff;
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

test("CAPTURE: real 0x3360 dispatches -- advanceSegmentColumns == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); advanceSegmentColumns(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: representative control / timer / threshold paths match the oracle", () => {
  const cases = [
    { name: "control-clear/idle-timers", in1: 0x10, d2: 0x00, d3: 0x00, cf: [0x05, 0x0a, 0x1c], cc: [0x00, 0x00, 0x00] },
    { name: "control-set/wrap", in1: 0xff, d2: 0x00, d3: 0x0c, cf: [0x10, 0x1b, 0x02], cc: [0x03, 0x00, 0x05] },
    { name: "d2-running/blank", in1: 0x00, d2: 0x40, d3: 0x00, cf: [0x07, 0x07, 0x07], cc: [0x02, 0x02, 0x02] },
    { name: "life-expiry/accumulate", in1: 0x10, d2: 0x00, d3: 0x0c, cf: [0x05, 0x05, 0x05], cc: [0x01, 0x01, 0x01], c9: 0x20, ca: 0x20 },
    { name: "threshold-commit", in1: 0x10, d2: 0x00, d3: 0x60, cf: [0x03, 0x03, 0x03], cc: [0x01, 0x01, 0x01], ca: 0xf0, cb: 0x01 },
    { name: "threshold-borrow", in1: 0x10, d2: 0x00, d3: 0x00, cf: [0x03, 0x03, 0x03], cc: [0x01, 0x01, 0x01], ca: 0x00 },
    { name: "d4-every8-backoff", in1: 0x10, d2: 0x00, d3: 0x00, d4: 0x07, cf: [0x10, 0x0a, 0x18], cc: [0x00, 0x00, 0x00] },
  ];
  for (const cs of cases) {
    const o = seed(cs), c = seed(cs);
    oracle(o); advanceSegmentColumns(c);
    assert.equal(ramDiff(o, c), null, cs.name);
  }
});

test("FUZZ: deterministic random states agree with the oracle in RAM (-stack)", () => {
  let s = 0x1234abcd >>> 0;
  const rnd = (n) => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 8) % n; };
  for (let i = 0; i < 400; i++) {
    const spec = {
      x: rnd(3), in1: rnd(256), d2: rnd(256), d3: rnd(256), d4: rnd(256),
      c9: rnd(256), ca: rnd(256), cb: rnd(256),
      cf: [rnd(256), rnd(256), rnd(256)], cc: [rnd(256), rnd(256), rnd(256)], c5: [rnd(256), rnd(256), rnd(256)],
    };
    const o = seed(spec), c = seed(spec);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) {
      // The 0x3411 dead-arm trap: the rewrite must trap exactly where the oracle does.
      assert.throws(() => advanceSegmentColumns(c), `fuzz#${i} idiomatic must trap with the oracle`);
      continue;
    }
    advanceSegmentColumns(c);
    assert.equal(ramDiff(o, c), null, `fuzz#${i} ${JSON.stringify(spec)}`);
  }
});

test("TEETH: a one-off in the SEGMENT_MOVE_ACCUM accumulator is caught by the RAM diff", () => {
  // A twin that computes everything correctly but leaves SEGMENT_MOVE_ACCUM one high (the dropped-`+1` accumulator
  // defect class). The RAM diff must flag SEGMENT_MOVE_ACCUM; a positive control that the CRAFTED arm can fail.
  const spec = { in1: 0x10, d2: 0x00, d3: 0x0c, cf: [0x05, 0x05, 0x05], cc: [0x01, 0x01, 0x01], c9: 0x20, ca: 0x20 };
  const broken = (m) => { advanceSegmentColumns(m); m.mem8[SEGMENT_MOVE_ACCUM] = (m.mem8[SEGMENT_MOVE_ACCUM] + 1) & 0xff; };
  const o = seed(spec), c = seed(spec);
  oracle(o); broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a one-off in SEGMENT_MOVE_ACCUM");
  assert.equal(d.addr, SEGMENT_MOVE_ACCUM & 0xffff);
});

test("TEETH(SP): the rewrite is seam-placeable; a pushing twin is not", () => {
  const entry = CAPS.length ? CAPS[0].clone() : seed({ cf: [0x05, 0x05, 0x05], cc: [0x01, 0x01, 0x01] });
  entry.regs.s = 0xff;
  const seated = entry.clone();
  seated.push16(0xabcd);
  assert.equal(seamPlaceable(withOmittedRet, advanceSegmentColumns, TARGET, seated.clone()).placeable, true);
  const spLeak = (m) => { m.push8(0x00); };
  assert.equal(seamPlaceable(withOmittedRet, spLeak, TARGET, seated.clone()).placeable, false);
});

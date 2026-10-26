// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stepPhasedCountersAndWrapCells (ROM 0x341b) -- the phased accumulator step
// (SEGMENT_MOVE_ACCUM_B/SEGMENT_ROW_CROSS_COUNT + loc_c8), the SEGMENT_MOVE_FRAME_COUNTER frame tick, and the every-other-frame modulo-0x10 wrap of
// loc_c5..loc_c7. CAPTURE checks real dispatches; because boot may not reach this routine (and cannot
// exercise every phase/frame parity), the CRAFTED arm drives all four phases, the no-borrow / borrow /
// discard accumulator paths, and both sweep passes; TEETH proves the RAM diff catches a twin that
// ignores the CPY #2 loc_c8 split; the SP-tooth proves the rewrite is seam-placeable.
// Run: node --test games/centiped/idiomatic/test/equivalence-341b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_341b as oracleRom } from "../../translated/loc_341b.js";
import { stepPhasedCountersAndWrapCells } from "../stepPhasedCountersAndWrapCells.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_c5, loc_c8, SEGMENT_MOVE_ACCUM_B, SEGMENT_ROW_CROSS_COUNT, loc_d3, SEGMENT_MOVE_FRAME_COUNTER } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x341b;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

// Seat the zero-page cells the routine reads/writes.
function seed({ d3, c9, cb, c8, d4, cells }) {
  const m = new Machine(ROM);
  m.mem.write8(loc_d3, d3 & 0xff);
  m.mem.write8(SEGMENT_MOVE_ACCUM_B, c9 & 0xff);
  m.mem.write8(SEGMENT_ROW_CROSS_COUNT, cb & 0xff);
  m.mem.write8(loc_c8, c8 & 0xff);
  m.mem.write8(SEGMENT_MOVE_FRAME_COUNTER, d4 & 0xff);
  for (let i = 0; i < 3; i++) m.mem.write8((loc_c5 + i) & 0xff, cells[i] & 0xff);
  return m;
}

test("CAPTURE: real 0x341b dispatches -- stepPhasedCountersAndWrapCells == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); stepPhasedCountersAndWrapCells(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: every phase, accumulator path, and both sweep passes match the oracle", () => {
  const cases = [
    // phase 0: SEGMENT_MOVE_ACCUM_B cleared, no loc_c8 bump; odd new-SEGMENT_MOVE_FRAME_COUNTER (0x02->0x03) so no sweep.
    { name: "phase0/no-sweep", d3: 0x00, c9: 0x40, cb: 0x05, c8: 0x10, d4: 0x02, cells: [0, 0, 0] },
    // phase 1 (step 1, +2 to loc_c8), no borrow; even new-SEGMENT_MOVE_FRAME_COUNTER -> pass 1 subtracts 0x10.
    { name: "phase1/pass1", d3: 0x01, c9: 0x40, cb: 0x05, c8: 0x10, d4: 0x01, cells: [0x25, 0x08, 0x37] },
    // phase 2 (step 1, +1 to loc_c8), no borrow; odd new-SEGMENT_MOVE_FRAME_COUNTER -> no sweep.
    { name: "phase2/no-sweep", d3: 0x02, c9: 0x40, cb: 0x05, c8: 0x10, d4: 0x02, cells: [0, 0, 0] },
    // phase 3 (step 2, +1 to loc_c8), no borrow.
    { name: "phase3/no-sweep", d3: 0x03, c9: 0x40, cb: 0x05, c8: 0x10, d4: 0x02, cells: [0, 0, 0] },
    // phase 3 borrow, high byte non-negative: store SEGMENT_ROW_CROSS_COUNT, clear SEGMENT_MOVE_ACCUM_B, bump loc_c8.
    { name: "phase3/borrow", d3: 0x03, c9: 0x01, cb: 0x05, c8: 0x10, d4: 0x02, cells: [0, 0, 0] },
    // phase 3 borrow that drives the high byte negative: whole update discarded (no stores/bump).
    { name: "phase3/discard", d3: 0x03, c9: 0x00, cb: 0x01, c8: 0x10, d4: 0x02, cells: [0, 0, 0] },
    // even frame, no pass-1 adjustment (all cells < 0x10) -> pass 2 subtracts 0x11, early-out on the
    // first nonzero cell from the top.
    { name: "pass2/earlyout", d3: 0x02, c9: 0x40, cb: 0x05, c8: 0x10, d4: 0x01, cells: [0x05, 0x03, 0x0a] },
    // even frame, pass 2 with a leading zero cell skipped before the early-out.
    { name: "pass2/skip-zero", d3: 0x02, c9: 0x40, cb: 0x05, c8: 0x10, d4: 0x01, cells: [0x04, 0x07, 0x00] },
    // even frame, all cells zero -> both passes no-op, only SEGMENT_MOVE_FRAME_COUNTER ticks.
    { name: "even/allzero", d3: 0x00, c9: 0x10, cb: 0x05, c8: 0x10, d4: 0x01, cells: [0, 0, 0] },
    // pass 1 multi-adjust with a mixed cell set.
    { name: "pass1/mixed", d3: 0x01, c9: 0x80, cb: 0x02, c8: 0xff, d4: 0x03, cells: [0x10, 0xff, 0x0f] },
  ];
  for (const cs of cases) {
    const o = seed(cs), c = seed(cs);
    oracle(o); stepPhasedCountersAndWrapCells(c);
    assert.equal(ramDiff(o, c), null, cs.name);
  }
});

test("CRAFTED: targeted cell values on representative paths", () => {
  // phase 1, no borrow, even frame with a pass-1 hit.
  const c = seed({ d3: 0x01, c9: 0x40, cb: 0x05, c8: 0x10, d4: 0x01, cells: [0x25, 0x08, 0x37] });
  stepPhasedCountersAndWrapCells(c);
  assert.equal(c.mem.read8(SEGMENT_MOVE_ACCUM_B), 0x3f, "SEGMENT_MOVE_ACCUM_B -= step(1)");
  assert.equal(c.mem.read8(loc_c8), 0x12, "loc_c8 += 2 for phase 1");
  assert.equal(c.mem.read8(SEGMENT_ROW_CROSS_COUNT), 0x05, "SEGMENT_ROW_CROSS_COUNT unchanged (no borrow)");
  assert.equal(c.mem.read8(SEGMENT_MOVE_FRAME_COUNTER), 0x02, "SEGMENT_MOVE_FRAME_COUNTER incremented");
  assert.equal(c.mem.read8((loc_c5 + 0) & 0xff), 0x15, "c5 0x25-0x10");
  assert.equal(c.mem.read8((loc_c5 + 1) & 0xff), 0x08, "c6 < 0x10 untouched");
  assert.equal(c.mem.read8((loc_c5 + 2) & 0xff), 0x27, "c7 0x37-0x10");

  // phase 3 discard: nothing in the accumulator group changes; only SEGMENT_MOVE_FRAME_COUNTER ticks (odd -> no sweep).
  const d = seed({ d3: 0x03, c9: 0x00, cb: 0x01, c8: 0x10, d4: 0x02, cells: [0, 0, 0] });
  stepPhasedCountersAndWrapCells(d);
  assert.equal(d.mem.read8(SEGMENT_MOVE_ACCUM_B), 0x00, "SEGMENT_MOVE_ACCUM_B unchanged (discard)");
  assert.equal(d.mem.read8(SEGMENT_ROW_CROSS_COUNT), 0x01, "SEGMENT_ROW_CROSS_COUNT unchanged (discard)");
  assert.equal(d.mem.read8(loc_c8), 0x10, "loc_c8 unchanged (discard)");
  assert.equal(d.mem.read8(SEGMENT_MOVE_FRAME_COUNTER), 0x03, "SEGMENT_MOVE_FRAME_COUNTER still ticks");
});

test("TEETH: a twin that ignores the CPY #2 loc_c8 split is caught by the RAM diff", () => {
  // Broken: always double-bumps loc_c8 (drops the `phase < 2` guard). On phase 2 the real routine bumps
  // once; the twin bumps twice -> loc_c8 diverges.
  const brokenStep = (m) => {
    const { mem } = m;
    const phase = mem.read8(loc_d3) & 0x03;
    if (phase === 0) { mem.write8(SEGMENT_MOVE_ACCUM_B, 0); }
    else {
      const carryIn = phase & 0x01;
      const step = ((phase >> 1) + carryIn) & 0xff;
      let acc = (step ^ 0xff) + mem.read8(SEGMENT_MOVE_ACCUM_B) + 1;
      let value = acc & 0xff;
      const noBorrow = acc > 0xff;
      let storeC9 = true, bumpC8 = true;
      if (!noBorrow) {
        acc = value + mem.read8(SEGMENT_ROW_CROSS_COUNT);
        value = acc & 0xff;
        if (value & 0x80) { storeC9 = false; bumpC8 = false; }
        else { mem.write8(SEGMENT_ROW_CROSS_COUNT, value); value = 0; }
      }
      if (bumpC8) {
        mem.write8(loc_c8, (mem.read8(loc_c8) + 1) & 0xff); // BUG: extra bump always applied
        mem.write8(loc_c8, (mem.read8(loc_c8) + 1) & 0xff);
      }
      if (storeC9) mem.write8(SEGMENT_MOVE_ACCUM_B, value);
    }
    const frame = (mem.read8(SEGMENT_MOVE_FRAME_COUNTER) + 1) & 0xff;
    mem.write8(SEGMENT_MOVE_FRAME_COUNTER, frame);
  };
  const spec = { d3: 0x02, c9: 0x40, cb: 0x05, c8: 0x10, d4: 0x02, cells: [0, 0, 0] };
  const o = seed(spec), c = seed(spec);
  oracle(o); brokenStep(c);
  const diff = ramDiff(o, c);
  assert.notEqual(diff, null, "the gate FAILED to catch the loc_c8 double-bump");
  assert.equal(diff.addr, loc_c8 & 0xffff);
});

test("TEETH(SP): the rewrite is seam-placeable; a twin that pushes is not", () => {
  const entry = CAPS.length
    ? CAPS[0].clone()
    : seed({ d3: 0x01, c9: 0x40, cb: 0x05, c8: 0x10, d4: 0x02, cells: [0x25, 0x08, 0x37] });
  assert.equal(
    seamPlaceable(withOmittedRet, stepPhasedCountersAndWrapCells, TARGET, entry.clone()).placeable,
    true,
  );
  const spLeak = (m) => { m.push8(0x00); };
  assert.equal(seamPlaceable(withOmittedRet, spLeak, TARGET, entry.clone()).placeable, false);
});

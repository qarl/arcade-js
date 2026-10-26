// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for scanForRangedCellAndSeed (ROM 0x2cef) -- frame/priority-gated, it walks the 16-bit
// cell-stream pointer ($db:$da) and, on the first cell whose low 6 bits land in [0x38,0x3f), erases it and
// seeds the coordinate/timer cells while advancing the frozen accumulator spine (0x2db6); on a fully
// wrapped pointer it tail-hands-off to the table draw (0x2d5c). Both sides invoke the SAME frozen 0x2db6 /
// 0x2d5c, so only the routine-local scan/erase/seed logic is under test. No register live-out -> compare
// work RAM (dumpState, minus stack scratch below the entry SP). The kept 0x2db6 JSR is balanced (push16 + its ret), so the
// terminals are omitted-ret leaves (moved 0); the SP-tooth proves placeable + refuses a strayed SP.
// Run: node --test games/centiped/idiomatic/test/equivalence-2cef.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2cef as oracleRom } from "../../translated/loc_2cef.js";
import { scanForRangedCellAndSeed } from "../scanForRangedCellAndSeed.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_00, SFX_TIMER_CH1_PRIORITY, FIELD_SCAN_PTR_LO, FIELD_SCAN_PTR_HI, loc_ef, loc_86, loc_88, loc_5f, loc_6f, loc_3f, loc_b2,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2cef;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before a boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Seat the gates + pointer + a cell stream. `cells` writes {addr:byte} into the pointed-at page so a
// crafted case can plant an in-range hit. $86 negative makes the spine an instant return by default.
function seed({ frame = 0x00, b7 = 0x00, da, db, ef = 0x0f, m86 = 0x80, cells, extra } = {}) {
  const m = new Machine(ROM);
  m.mem8[loc_00] = frame;
  m.mem8[SFX_TIMER_CH1_PRIORITY] = b7;
  if (da !== undefined) m.mem8[FIELD_SCAN_PTR_LO] = da;
  if (db !== undefined) m.mem8[FIELD_SCAN_PTR_HI] = db;
  m.mem8[loc_ef] = ef;
  m.mem8[loc_86] = m86;
  if (cells) for (const [a, v] of Object.entries(cells)) m.mem8[Number(a)] = v;
  if (extra) extra(m);
  return m;
}

test("CAPTURE: real 0x2cef dispatches -- scanForRangedCellAndSeed == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); scanForRangedCellAndSeed(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: gates / boundary / hit / scan / tail == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "frame gate (not the eighth frame)", frame: 0x01, db: 0x01, da: 0x50 },
    { tag: "priority-cell busy", frame: 0x00, b7: 0x05, db: 0x01, da: 0x50 },
    { tag: "high byte exhausted", db: 0x00, da: 0x10 },
    { tag: "top-of-page fold clears the high byte", db: 0x07, da: 0xd0 },
    // Immediate in-range hit (spine early-out): cell 0x38 at 0x0150.
    { tag: "hit immediate", db: 0x01, da: 0x50, cells: { 0x0150: 0x38 } },
    // Skip an out-of-range cell then hit the next.
    { tag: "scan then hit", db: 0x01, da: 0x50, cells: { 0x0150: 0x10, 0x0151: 0x3a } },
    // Hit with the spine doing the real BCD advance, seeded so the target is never reached (no watchdog).
    { tag: "hit + spine BCD advance", db: 0x01, da: 0x60, m86: 0x00,
      cells: { 0x0160: 0x39 }, extra: (m) => { m.mem8[loc_88] = 0; m.mem8[0x00ad] = 0xff; m.mem8[0x00af] = 0xff; } },
    // Page-boundary pointer: the scan/wrap/tail machinery runs identically on both sides over the same data.
    { tag: "page-boundary scan/wrap", db: 0xff, da: 0xfe },
  ];
  for (const cs of cases) {
    const o = seed(cs), c = seed(cs);
    oracle(o); scanForRangedCellAndSeed(c);
    assert.equal(ramDiff(o, c), null, cs.tag);
  }
});

test("CRAFTED: the hit erases the cell and seeds the coord/timer cells byte-for-byte", () => {
  const cs = { db: 0x01, da: 0x50, ef: 0x0f, cells: { 0x0150: 0x38 } };
  const o = seed(cs), c = seed(cs);
  oracle(o); scanForRangedCellAndSeed(c);
  assert.equal(c.mem8[0x0150], 0x3f ^ 0x0f, "cell erased with the mask fold");
  assert.equal(c.mem8[loc_3f], 0xff, "$3f sentinel set");
  assert.equal(c.mem8[loc_b2], 0x13, "timer cell re-armed");
  assert.equal(c.mem8[FIELD_SCAN_PTR_LO], 0x51, "pointer bumped past the cell");
  assert.equal(o.mem8[loc_5f], c.mem8[loc_5f], "$5f seed matches oracle");
  assert.equal(o.mem8[loc_6f], c.mem8[loc_6f], "$6f seed matches oracle");
});

test("TEETH: a twin that skips the timer re-arm is caught by the RAM diff", () => {
  const brokenNoReArm = (mm) => { scanForRangedCellAndSeed(mm); mm.mem8[loc_b2] = 0x00; }; // BUG: timer left cleared
  const cs = { db: 0x01, da: 0x50, cells: { 0x0150: 0x38 } };
  const o = seed(cs), c = seed(cs);
  oracle(o); brokenNoReArm(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a cleared timer re-arm");
});

test("SP-TOOTH: an omitted-ret terminal places; a stray-push mutant is refused", () => {
  const mk = () => {
    const m = seed({ db: 0x01, da: 0x50, cells: { 0x0150: 0x38 } }); // hit path: runs the balanced 0x2db6 JSR
    m.regs.s = 0xfb;
    m.mem.write16(0x0100 | ((m.regs.s + 1) & 0xff), 0xabcd); // a real caller-return word for the seam
    return m;
  };
  const r = seamPlaceable(withOmittedRet, scanForRangedCellAndSeed, TARGET, mk());
  assert.equal(r.placeable, true, `scanForRangedCellAndSeed must be seam-placeable; got: ${r.error}`);
  const strayMutant = (mm) => { const rr = scanForRangedCellAndSeed(mm); mm.push16(0x1234); return rr; };
  assert.equal(seamPlaceable(withOmittedRet, strayMutant, TARGET, mk()).placeable, false, "the seam must REFUSE a strayed SP");
  console.log("  SP-TOOTH: omitted-ret terminal placeable, stray-push refused");
});

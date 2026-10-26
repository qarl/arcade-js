// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for redrawPointerTableRowUnblanked (ROM 0x3825) -- clears the loc_8c blank/sign cell
// then tail-dispatches into the row-emit "from start" re-entry (0x3801) with index 0, so the current row
// redraws unblanked. Observable output is RAM only: loc_8b/loc_8c/loc_91-94 plus every cell the emit loop
// writes. CAPTURE replays real boot dispatches; a manufactured-descriptor arm exercises the emit loop
// deterministically (blank/fold/terminate); TEETH proves the RAM diff catches a failure to clear loc_8c;
// the SP-tooth proves the SP-neutral tail-dispatch is seam-placeable and a pushing twin is not.
// Run: node --test games/centiped/idiomatic/test/equivalence-3825.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3825 as oracleRom } from "../../translated/loc_3825.js";
import { redrawPointerTableRowUnblanked } from "../redrawPointerTableRowUnblanked.js";
import { rewritePointerTableRowFromStart } from "../writePointerTableRow.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_8c, loc_91, loc_92, loc_93, loc_94, loc_ef, loc_f3 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3825;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 2500) : [];

// Manufacture a self-contained row: a descriptor buffer in RAM, an output cursor, a zeroed mask/high-adjust,
// and a pre-set blank cell (which the routine must clear). Each byte's low six bits is the tile code; the
// first byte with the top bit set ends the row.
const DESC = 0x0280, OUT = 0x0300;
function seed({ bytes, sign = 0x80, mask = 0x00, f3 = 0x00 }) {
  const m = new Machine(ROM);
  m.mem.write8(loc_93, DESC & 0xff);
  m.mem.write8(loc_94, (DESC >> 8) & 0xff);
  m.mem.write8(loc_91, OUT & 0xff);
  m.mem.write8(loc_92, (OUT >> 8) & 0xff);
  m.mem.write8(loc_ef, mask & 0xff);
  m.mem.write8(loc_f3, f3 & 0xff);
  m.mem.write8(loc_8c, sign & 0xff);
  for (let i = 0; i < bytes.length; i++) m.mem.write8((DESC + i) & 0xffff, bytes[i] & 0xff);
  return m;
}

test("CAPTURE: real 0x3825 dispatches -- redrawPointerTableRowUnblanked == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "no 0x3825 dispatches captured");
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); redrawPointerTableRowUnblanked(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: manufactured rows (blank code / 0x30 fold / terminate) match the oracle", () => {
  const cases = [
    { tag: "space code forces blank", bytes: [0x41, 0x20, 0xc3] },
    { tag: "0x30-range folds down", bytes: [0x35, 0x3f, 0xc0] },
    { tag: "single terminator", bytes: [0x81] },
    { tag: "sign seed already clear", bytes: [0x41, 0x42, 0xc3], sign: 0x00 },
    { tag: "nonzero mask", bytes: [0x41, 0x22, 0xc3], mask: 0x03, f3: 0x01 },
  ];
  for (const cs of cases) {
    const o = seed(cs), c = seed(cs);
    oracle(o); redrawPointerTableRowUnblanked(c);
    assert.equal(ramDiff(o, c), null, cs.tag);
    assert.equal(c.mem.read8(loc_8c), 0x00, `blank cell cleared: ${cs.tag}`);
  }
});

test("TEETH: a failure to clear the blank cell is caught by the RAM diff", () => {
  // The routine must zero loc_8c; a twin that redraws without clearing it leaves the seeded 0x80, which
  // blanks every emitted byte -- so both loc_8c and the drawn cells diverge from the oracle.
  const spec = { bytes: [0x41, 0x42, 0xc3], sign: 0x80 };
  const broken = (m) => rewritePointerTableRowFromStart(m, 0); // BUG: never clears loc_8c
  const o = seed(spec), c = seed(spec);
  oracle(o); broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a skipped blank-cell clear");
});

test("SP-TOOTH: the SP-neutral tail-dispatch is seam-placeable; a pushing twin is not", () => {
  const entry = CAPS[0].clone();
  const r = seamPlaceable(withOmittedRet, redrawPointerTableRowUnblanked, TARGET, entry);
  assert.equal(r.placeable, true, `redrawPointerTableRowUnblanked must be seam-placeable; got: ${r.error}`);
  const mutant = (m) => { m.push16(0xffff); return redrawPointerTableRowUnblanked(m); };
  const r2 = seamPlaceable(withOmittedRet, mutant, TARGET, CAPS[0].clone());
  assert.equal(r2.placeable, false, "the SP-tooth FAILED to refuse an SP-adrift mutant");
  console.log("  SP-TOOTH: SP-neutral tail-dispatch placeable; adrift mutant refused");
});

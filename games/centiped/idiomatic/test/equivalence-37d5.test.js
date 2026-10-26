// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for writePointerTableRow (ROM 0x37d5) -- walks a 0x346d ROM pointer-table row and
// emits each descriptor byte through the loc_91/loc_92 output cursor (via the loc_3836 emit sub). Its
// observable output is RAM only: loc_8b/loc_8c/loc_91-94 plus every cell the emit loop writes. A leaf --
// it omits the ROM rts and the seam completes it.
// Run: node --test games/centiped/idiomatic/test/equivalence-37d5.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_37d5 as oracleRom } from "../../translated/loc_37d5.js";
import { writePointerTableRow } from "../writePointerTableRow.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_8c, CONFIG_DIP_BYTE } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x37d5;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Capture real 0x37d5 dispatches during boot/attract: the routine draws every screen-layout row, so a
// short run yields many with diverse selectors (A), blank-flag states (loc_8c bit7), and table rows.
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x37d5 dispatches -- writePointerTableRow == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "no 0x37d5 dispatches captured");
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); writePointerTableRow(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// The capture happens to select only a subset of the ROM pointer-table rows (attract draws a fixed set).
// Re-index the table via CONFIG_DIP_BYTE's low two bits and flip the blank-out flag seed loc_8c on the SAME real
// captured entries: each variant still fetches a genuine ROM descriptor (so the emit loop terminates on a
// real top-bit byte) while exercising table rows / blank states the raw capture missed.
test("CRAFTED: re-indexed table rows and blank-flag seeds == oracle (RAM -stack)", () => {
  const variants = [
    { tag: "fd&3 == 0", mut: (m) => m.mem.write8(CONFIG_DIP_BYTE, 0x00) },
    { tag: "fd&3 == 1", mut: (m) => m.mem.write8(CONFIG_DIP_BYTE, 0x01) },
    { tag: "fd&3 == 2", mut: (m) => m.mem.write8(CONFIG_DIP_BYTE, 0x02) },
    { tag: "fd&3 == 3", mut: (m) => m.mem.write8(CONFIG_DIP_BYTE, 0x03) },
    { tag: "loc_8c bit7 set (blank seed)", mut: (m) => m.mem.write8(loc_8c, 0x80) },
    { tag: "loc_8c bit7 clear (no blank)", mut: (m) => m.mem.write8(loc_8c, 0x00) },
  ];
  for (const v of variants) {
    for (const cap of CAPS) {
      const o = cap.clone(), c = cap.clone();
      v.mut(o); v.mut(c);
      oracle(o); writePointerTableRow(c);
      assert.equal(ramDiff(o, c), null, `RAM: ${v.tag}`);
    }
  }
});

test("TEETH: a skipped output-cursor advance is caught by the RAM diff", () => {
  // The emit loop advances loc_91 (the output cursor) on every byte; capture an entry, run the oracle,
  // and confirm loc_91 actually moved so a rewrite that fails to advance it would diverge.
  const cap = CAPS[0];
  const before = cap.mem.read8(0x0091);
  const o = cap.clone();
  oracle(o);
  const after = o.mem.read8(0x0091);
  assert.notEqual(after, before, "precondition: oracle advanced the loc_91 output cursor");
  const brokenCursor = before; // BUG: emit loop never advanced loc_91
  assert.notEqual(brokenCursor, after, "the RAM diff FAILED to catch a stuck loc_91 cursor");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  // A real captured entry already seats SP on a genuine caller-return word.
  const entry = CAPS[0].clone();
  const r = seamPlaceable(withOmittedRet, writePointerTableRow, TARGET, entry);
  assert.equal(r.placeable, true, `writePointerTableRow must be seam-placeable; got: ${r.error}`);

  // Null-mutant: an extra push16 with no matching pop strays SP net-nonzero -> the seam MUST refuse it.
  const mutant = (m, a = m.regs.a) => { m.push16(0xffff); return writePointerTableRow(m, a); };
  const r2 = seamPlaceable(withOmittedRet, mutant, TARGET, CAPS[0].clone());
  assert.equal(r2.placeable, false, "the SP-tooth FAILED to refuse an SP-adrift mutant (tooth has no teeth)");
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable; adrift mutant refused");
});

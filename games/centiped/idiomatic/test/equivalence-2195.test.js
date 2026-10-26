// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for plotConfigTableRow (ROM 0x2195). It draws a config-selected readout through
// the shared row/glyph/digit writers, threading each writer's exposed exit carry into the next; all
// observable output is RAM (work + video RAM, both in dumpState), so each arm checks the RAM diff (minus
// stack scratch below the entry SP). The writers are carry-coupled: the glyph plot's exit carry is php-saved (not its
// store's carry), which diverges from the store's carry only when the cursor high byte overflows -- so
// the CRAFTED arm sweeps the flip mask (ef/f3) to exercise that coupled path on both sides.
// Run: node --test games/centiped/idiomatic/test/equivalence-2195.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2195 as oracleRom } from "../../translated/loc_2195.js";
import { plotConfigTableRow } from "../plotConfigTableRow.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { CONFIG_DIP_BYTE, loc_91, loc_92, loc_8b, loc_8c, loc_ef, loc_f0, loc_f2, loc_f3, loc_b0 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2195;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

// Seat a valid output cursor (a real dispatch's column cursor into video RAM) and a caller-return word
// at the entry SP (compared), so the kept spine writers store in-range and the seam has a real return slot.
function seat(m, s = {}) {
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab);
  m.mem.write8(loc_91, s.p91 ?? 0xf0); m.mem.write8(loc_92, s.p92 ?? 0x06); // cursor -> 0x06f0 video RAM
  m.mem.write8(loc_8b, s.c8b ?? 0x14); m.mem.write8(loc_8c, s.c8c ?? 0x80);
  m.mem.write8(loc_ef, s.ef ?? 0x00); m.mem.write8(loc_f0, s.f0 ?? 0x00);
  m.mem.write8(loc_f2, s.f2 ?? 0x00); m.mem.write8(loc_f3, s.f3 ?? 0x00);
  m.mem.write8(CONFIG_DIP_BYTE, s.fd ?? 0x00);
  m.regs.fC = s.carry ?? false;
}

test("CAPTURE: real 0x2195 dispatches -- plotConfigTableRow == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); plotConfigTableRow(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: every select index x incoming carry x screen flip == oracle (RAM)", () => {
  // fd bits 5-4 select the table index {0,2,4,6}; index 0/6 make the printed byte 0x00, whose digit
  // print is the carry-sensitive case, so both incoming-carry values are exercised. The flip mask
  // (ef/f3 = 0xff) couples the cursor high-byte overflow into the writers, so the glyph plot's true
  // php-saved exit carry diverges from its store's carry there -- the case a upright-only seed misses.
  for (const fd of [0x00, 0x10, 0x20, 0x30]) {
    for (const carry of [false, true]) {
      for (const flip of [false, true]) {
        const s = { fd, carry, ef: flip ? 0xff : 0x00, f3: flip ? 0xff : 0x00 };
        const o = new Machine(ROM); seat(o, s);
        const c = new Machine(ROM); seat(c, s);
        oracle(o); plotConfigTableRow(c);
        assert.equal(ramDiff(o, c), null, `fd=${fd.toString(16)} carry=${carry} flip=${flip}`);
      }
    }
  }
});

test("TEETH: a wrong stashed table byte is caught by the RAM diff", () => {
  const s = { fd: 0x30, carry: false }; // index 6 -> a nonzero parallel-table byte in $b0
  const o = new Machine(ROM); seat(o, s);
  oracle(o);
  const truth = o.dumpState();
  const broken = new Machine(ROM); seat(broken, s);
  oracle(broken);
  broken.mem8[loc_b0] = (broken.mem8[loc_b0] + 1) & 0xff; // BUG: a single wrong stashed byte
  assert.notEqual(
    firstStateDiff(truth, broken.dumpState(), (off) => broken.stateOffsetToAddr(off), deadStackAtEntry(o, broken)),
    null,
    "the RAM diff FAILED to catch a wrong stashed byte",
  );
});

test("SP-TOOTH: the tail-dispatch rewrite is seam-placeable, and a stack-adrift mutant is refused", () => {
  const m = new Machine(ROM); seat(m);
  const r = seamPlaceable(withOmittedRet, plotConfigTableRow, TARGET, m);
  assert.equal(r.placeable, true, `plotConfigTableRow must be seam-placeable; got: ${r.error}`);
  const nullMutant = (mm) => { mm.push16(0x1234); }; // unbalanced push -> SP adrift
  const bad = seamPlaceable(withOmittedRet, nullMutant, TARGET, new Machine(ROM));
  assert.equal(bad.placeable, false, "the SP-TOOTH FAILED to refuse a stack-adrift mutant");
  console.log("  SP-TOOTH: tail dispatch placeable; adrift mutant refused");
});

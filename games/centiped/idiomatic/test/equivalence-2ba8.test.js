// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stampEmptyTileCell (ROM 0x2ba8) -- when the cell at ($32) is empty and its
// column class is stampable, write 0x3f^$ef through the pointer, first bumping $d7,X (X=$88) for the
// bumped sub-class. A leaf with no register/flag live-out (callers reload X or tail-return), so the arms
// compare RAM (dumpState, minus stack scratch below the entry SP) only. CAPTURE checks real dispatches; CRAFTED drives the
// class table (empty/occupied, guard/bump/write-only, both $ef orientations); TEETH proves the RAM diff
// catches a twin that bumps the counter for a write-only column.
// Run: node --test games/centiped/idiomatic/test/equivalence-2ba8.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2ba8 as oracleRom } from "../../translated/loc_2ba8.js";
import { stampEmptyTileCell } from "../stampEmptyTileCell.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { TILEMAP_PTR_LO, TILEMAP_PTR_HI, loc_ef, loc_88, loc_d7 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2ba8;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 1500) : [];

// Seat ($32/$33) at a chosen cell, set the fold mask $ef and the actor slot $88, optionally preload the
// target cell. Pointer high byte kept in 0x04..0x07 so the cell lands in readable RAM.
function seed({ ptrLo, ptrHi = 0x05, ef, slot = 0x03, cell }) {
  const m = new Machine(ROM);
  m.mem.write8(TILEMAP_PTR_LO, ptrLo);
  m.mem.write8(TILEMAP_PTR_HI, ptrHi);
  m.mem.write8(loc_ef, ef);
  m.mem.write8(loc_88, slot);
  if (cell !== undefined) m.mem.write8((ptrHi << 8) | ptrLo, cell);
  return m;
}

test("CAPTURE: real 0x2ba8 dispatches -- stampEmptyTileCell == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); stampEmptyTileCell(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: empty/occupied + column-class table (both $ef orientations)", () => {
  const cases = [
    // $ef == 0 orientation: guard cols 0/1/0x1f skip; [2,0x0b] bump; [0x0c,0x1e] write-only.
    { ptrLo: 0x05, ef: 0x00, cell: undefined, stamped: 0x3f, bumped: true },  // col 5 -> bump + stamp
    { ptrLo: 0x0d, ef: 0x00, cell: undefined, stamped: 0x3f, bumped: false }, // col 0x0d -> write only
    { ptrLo: 0x01, ef: 0x00, cell: undefined, stamped: null, bumped: false }, // col 1 excluded
    { ptrLo: 0x00, ef: 0x00, cell: undefined, stamped: null, bumped: false }, // col 0 guard
    { ptrLo: 0x1f, ef: 0x00, cell: undefined, stamped: null, bumped: false }, // col 0x1f guard
    { ptrLo: 0x05, ef: 0x00, cell: 0x99, stamped: null, bumped: false },      // occupied -> no-op
    // $ef != 0 orientation: 0x1e excluded; >=0x14 bump; <0x14 write-only.
    { ptrLo: 0x14, ef: 0x80, cell: undefined, stamped: 0xbf, bumped: true },  // col 0x14 -> bump + stamp
    { ptrLo: 0x10, ef: 0x80, cell: undefined, stamped: 0xbf, bumped: false }, // col 0x10 -> write only
    { ptrLo: 0x1e, ef: 0x80, cell: undefined, stamped: null, bumped: false }, // col 0x1e excluded
  ];
  for (const cs of cases) {
    const o = seed(cs), c = seed(cs);
    oracle(o); stampEmptyTileCell(c);
    const tag = `ptrLo=0x${cs.ptrLo.toString(16)} ef=0x${cs.ef.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    const ptr = (0x05 << 8) | cs.ptrLo;
    const cntAddr = (loc_d7 + 0x03) & 0xff;
    if (cs.stamped !== null) assert.equal(c.mem.read8(ptr), cs.stamped, `stamp ${tag}`);
    else if (cs.cell === undefined) assert.equal(c.mem.read8(ptr), 0x00, `no stamp ${tag}`);
    assert.equal(c.mem.read8(cntAddr), cs.bumped ? 1 : 0, `bump ${tag}`);
  }
});

test("TEETH: a twin that bumps the counter for a write-only column is caught by the RAM diff", () => {
  // Broken twin: real gate + stamp, but bumps $d7,X for EVERY stampable column (drops the class split).
  const brokenAlwaysBump = (mm) => {
    const { mem8, mem16 } = mm;
    const ptr = mem16[TILEMAP_PTR_LO];
    if (mem8[ptr] !== 0) return;
    const col = mem8[TILEMAP_PTR_LO] & 0x1f;
    if (col === 0 || col === 0x1f) return;
    const ef = mem8[loc_ef];
    if (ef === 0 ? col === 0x01 : col === 0x1e) return;
    const x = mem8[loc_88];
    const cnt = (loc_d7 + x) & 0xff;
    mem8[cnt] = (mem8[cnt] + 1) & 0xff; // BUG: bumps even for write-only columns
    mem8[ptr] = 0x3f ^ ef;
  };
  const cs = { ptrLo: 0x0d, ef: 0x00 }; // col 0x0d: real code writes only, no bump
  const o = seed(cs), c = seed(cs);
  oracle(o); brokenAlwaysBump(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the spurious counter bump");
  assert.equal(d.addr, (loc_d7 + 0x03) & 0xff);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write16(0x0100 | ((m.regs.s + 1) & 0xff), 0xabcd); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, stampEmptyTileCell, TARGET, m);
  assert.equal(r.placeable, true, `stampEmptyTileCell must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});

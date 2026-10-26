// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for resolveTileCellAtXY (ROM 0x2c2b) -- from A (screen X) and Y (row) build the
// ($32/$33) tile-cell pointer, clamp the row, wrap the top row, then fetch the cell (folding $ef in when
// non-empty). TWO live-outs beyond RAM: A = the fetched value (callers cmp/and it) and its N/Z (callers
// beq/bne it), so the arms compare RAM (dumpState, minus stack scratch below the entry SP) AND A/fZ/fN. CAPTURE checks real
// dispatches; CRAFTED drives the wrap / non-wrap / empty-cell / clamp paths (RAM 0x0400-0x07ff filled so
// the resolved cell is deterministic); TEETH proves the RAM diff catches a twin that skips the top-row wrap.
// Run: node --test games/centiped/idiomatic/test/equivalence-2c2b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2c2b as oracleRom } from "../../translated/loc_2c2b.js";
import { resolveTileCellAtXY } from "../resolveTileCellAtXY.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { TILEMAP_PTR_LO, loc_8b, loc_ef } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2c2b;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 1500) : [];

function liveOutsEqual(o, c, tag) {
  assert.equal(ramDiff(o, c), null, `RAM ${tag}`);
  assert.equal(c.regs.a, o.regs.a, `A ${tag}`);
  assert.equal(c.regs.fZ, o.regs.fZ, `Z ${tag}`);
  assert.equal(c.regs.fN, o.regs.fN, `N ${tag}`);
}

// Seat the register inputs A (x) and Y (row) plus $8b (row scratch) and $ef (fold mask); optionally fill
// the whole 0x0400-0x07ff RAM window so the resolved cell (pointer high byte always 4..7) is deterministic.
function seed({ a, y, m8b = 0x00, ef = 0x00, fill }) {
  const m = new Machine(ROM);
  m.regs.a = a; m.regs.y = y;
  m.mem.write8(loc_8b, m8b);
  m.mem.write8(loc_ef, ef);
  if (fill !== undefined) for (let addr = 0x0400; addr < 0x0800; addr++) m.mem.write8(addr, fill);
  return m;
}

test("CAPTURE: real 0x2c2b dispatches -- resolveTileCellAtXY == oracle in RAM (-stack) + A/N/Z", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); resolveTileCellAtXY(c);
    liveOutsEqual(o, c, "capture");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: wrap / non-wrap / empty-cell / clamp paths (RAM + A/N/Z)", () => {
  const cases = [
    { name: "wrap, occupied", a: 0x08, y: 0x00, m8b: 0x00, ef: 0x5a, fill: 0xab },
    { name: "wrap, empty", a: 0x08, y: 0x00, m8b: 0x00, ef: 0x5a, fill: 0x00 },
    { name: "non-wrap hi!=7", a: 0x00, y: 0x0f, m8b: 0x00, ef: 0x11, fill: 0xab },
    { name: "empty cell -> Z", a: 0x40, y: 0x02, m8b: 0x10, ef: 0x33, fill: 0x00 },
    { name: "clamp floor", a: 0xff, y: 0x1f, m8b: 0x00, ef: 0x0f, fill: 0xab },
    { name: "high row", a: 0x80, y: 0x0a, m8b: 0x20, ef: 0x77, fill: 0xab },
  ];
  for (const cs of cases) {
    const o = seed(cs), c = seed(cs);
    oracle(o); resolveTileCellAtXY(c);
    liveOutsEqual(o, c, cs.name);
  }
  // Sanity: the empty-cell case leaves A==0 with Z set; an occupied case leaves Z clear.
  const empty = seed({ a: 0x40, y: 0x02, m8b: 0x10, ef: 0x33, fill: 0x00 });
  resolveTileCellAtXY(empty);
  assert.equal(empty.regs.a, 0x00, "empty cell -> A 0");
  assert.equal(empty.regs.fZ, true, "empty cell -> Z set");
});

test("TEETH: a twin that skips the top-row wrap mis-writes the pointer low byte", () => {
  // Broken twin: identical pointer math but never applies the (val & 0x1f)|0xa0 top-row wrap.
  const brokenNoWrap = (mm, a = mm.regs.a, y = mm.regs.y) => {
    const { mem8, mem16 } = mm;
    const lo = ((a >> 3) + ((a >> 2) & 1)) & 0xff;
    mem8[TILEMAP_PTR_LO] = lo;
    mem8[0x33] = 0x01;
    const acc = (((y << 3) & 0xff) + mem8[loc_8b]) & 0xff;
    mem8[loc_8b] = acc;
    let col = (acc <= 0xf7 ? (0xf7 - acc) & 0xff : 0x00) & 0xf8;
    let hi = 0x01;
    hi = ((hi << 1) | ((col >> 7) & 1)) & 0xff; col = (col << 1) & 0xff;
    hi = ((hi << 1) | ((col >> 7) & 1)) & 0xff; col = (col << 1) & 0xff;
    mem8[0x33] = hi;
    const val = col | lo; // BUG: no top-row wrap
    mem8[TILEMAP_PTR_LO] = val;
    const ptr = mem16[TILEMAP_PTR_LO];
    let result = mem8[ptr];
    if (result !== 0) result = (result ^ mem8[loc_ef]) & 0xff;
    mm.regs.setNZ(result);
    return (mm.regs.a = result);
  };
  const cs = { a: 0x08, y: 0x00, m8b: 0x00, ef: 0x5a, fill: 0xab }; // hits the wrap in the real routine
  const o = seed(cs), c = seed(cs);
  oracle(o); brokenNoWrap(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the skipped top-row wrap");
  assert.equal(d.addr, TILEMAP_PTR_LO & 0xffff);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write16(0x0100 | ((m.regs.s + 1) & 0xff), 0xabcd); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, resolveTileCellAtXY, TARGET, m);
  assert.equal(r.placeable, true, `resolveTileCellAtXY must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});

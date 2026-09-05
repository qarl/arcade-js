// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_098e — crafted-entry equivalence for the occupancy-grid reduction. Every live-out is work RAM
 * (row/column OR tables at 0x41e8/0x41f0, the X-bounds pair at 0x4210, and the four region flags at
 * 0x4220/0x4221/0x4225/0x4226), all in the state dump, so ramDiff alone is the whole check. The seed
 * lays a grid whose occupied columns are {2,3,7} in rows {4,5} and two object-table fields with
 * distinct bits, so the row/column ORs, the inward-stepping edge scans, and the toggled flags all
 * come out non-trivial and each output region carries teeth.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_098e as cand } from "../loc_098e.js";
import { loc_098e as oracle } from "../../translated/loc_098e.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const GRID = 0x4123;      // 6 rows x 10 cols, rows stride 0x10
const GRID_ROW = 0x10;
const ROW_TABLE = 0x41e8; // guards +0..+1, row ORs +2..+7
const COL_TABLE = 0x41f0; // guards +0..+2, col ORs +3..+12
const BOUND_LO = 0x4210;  // bound scanned from the right end (low byte of the pair)
const BOUND_HI = 0x4211;  // bound scanned from the left end (high byte)
const FLAG_TOP4 = 0x4221;
const FLAG_ALL = 0x4220;
const FLAG_OBJ7 = 0x4226;
const FLAG_OBJ_AB = 0x4225;
const OBJ_A = 0x42d0;     // 7 slots stride 0x20
const OBJ_B = 0x42b1;     // 8 slots stride 0x20
const STRIDE = 0x20;

const seed = () => craft((mem, mm) => {
  mm.push16(0x9999); // return address for the leaf's ret
  for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) mem[GRID + r * GRID_ROW + c] = 0;
  mem[GRID + 4 * GRID_ROW + 2] = 1; // row4 col2
  mem[GRID + 5 * GRID_ROW + 3] = 1; // row5 col3
  mem[GRID + 5 * GRID_ROW + 7] = 1; // row5 col7
  for (let i = 0; i < 7; i++) mem[OBJ_A + i * STRIDE] = 0;
  for (let i = 0; i < 8; i++) mem[OBJ_B + i * STRIDE] = 0;
  mem[OBJ_A + 1 * STRIDE] = 4; // a bit only the 7-slot field carries
  mem[OBJ_B + 1 * STRIDE] = 2; // a bit only the 8-slot field carries
});

test("EQUAL (crafted): loc_098e == oracle reduces the grid into every summary cell", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, seed()), null, "loc_098e diverged from the reduction");

  // Non-vacuous: the oracle really computes each live-out region.
  const a = seed(); oracle(a);
  const rowOrs = [0, 1, 2, 3, 4, 5].map((r) => a.mem8[ROW_TABLE + 2 + r]);
  const colOrs = Array.from({ length: 10 }, (_, c) => a.mem8[COL_TABLE + 3 + c]);
  assert.deepEqual(rowOrs, [0, 0, 0, 0, 1, 1], "row ORs");
  assert.deepEqual(colOrs, [0, 0, 1, 1, 0, 0, 0, 1, 0, 0], "column ORs");
  assert.equal(a.mem8[ROW_TABLE + 0], 0, "row guard 0");
  assert.equal(a.mem8[ROW_TABLE + 1], 0, "row guard 1");
  assert.equal(a.mem8[COL_TABLE + 0], 0, "col guard 0");
  assert.equal(a.mem8[COL_TABLE + 2], 0, "col guard 2");
  // Occupied columns {2,3,7}: from-right 34+2*16=66, from-left 224-2*16=192.
  assert.equal(a.mem8[BOUND_LO], 66, "from-right bound");
  assert.equal(a.mem8[BOUND_HI], 192, "from-left bound");
  assert.equal(a.mem8[FLAG_TOP4], 1, "top-four-rows flag (empty -> toggled to 1)");
  assert.equal(a.mem8[FLAG_ALL], 0, "whole-grid flag (occupied -> toggled to 0)");
  assert.equal(a.mem8[FLAG_OBJ7], 5, "7-slot object flag (4 ^ 1)");
  assert.equal(a.mem8[FLAG_OBJ_AB], 7, "combined object flag ((4|2) ^ 1)");
  console.log("  EQUAL: loc_098e == oracle; rows/cols/bounds/flags all match");
});

// Empty grid: no occupied column, so both edge scans exhaust and reset to their base X.
const emptySeed = () => craft((mem, mm) => {
  mm.push16(0x9999);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) mem[GRID + r * GRID_ROW + c] = 0;
  for (let i = 0; i < 7; i++) mem[OBJ_A + i * STRIDE] = 0;
  for (let i = 0; i < 8; i++) mem[OBJ_B + i * STRIDE] = 0;
});

test("EQUAL (crafted): loc_098e == oracle resets the edge scans on an empty grid", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, emptySeed()), null, "loc_098e diverged on the empty grid");
  const a = emptySeed(); oracle(a);
  assert.equal(a.mem8[BOUND_LO], 34, "from-right reset base");
  assert.equal(a.mem8[BOUND_HI], 224, "from-left reset base");
  assert.equal(a.mem8[FLAG_ALL], 1, "empty grid -> whole-grid flag toggled to 1");
  console.log("  EQUAL: loc_098e == oracle on empty grid; edges reset to 34/224");
});

test("TEETH: broken twins are caught (RAM)", { skip }, () => {
  const noOp = () => {};
  const flipRowOr = (m) => { oracle(m); m.mem8[ROW_TABLE + 2 + 4] ^= 1; };
  const flipColOr = (m) => { oracle(m); m.mem8[COL_TABLE + 3 + 2] ^= 1; };
  const dirtyGuard = (m) => { oracle(m); m.mem8[COL_TABLE + 0] = 0xff; };
  const swapBounds = (m) => { oracle(m); const r = m.mem8[BOUND_LO]; m.mem8[BOUND_LO] = m.mem8[BOUND_HI]; m.mem8[BOUND_HI] = r; };
  const missToggle = (m) => { oracle(m); for (const f of [FLAG_ALL, FLAG_TOP4, FLAG_OBJ7, FLAG_OBJ_AB]) m.mem8[f] ^= 1; };
  const skipObjBFold = (m) => { oracle(m); m.mem8[FLAG_OBJ_AB] = m.mem8[FLAG_OBJ7]; };

  assert.ok(ramDiff(oracle, noOp, seed()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, flipRowOr, seed()), "wrong-row-OR twin escaped");
  assert.ok(ramDiff(oracle, flipColOr, seed()), "wrong-column-OR twin escaped");
  assert.ok(ramDiff(oracle, dirtyGuard, seed()), "uncleared-guard twin escaped");
  assert.ok(ramDiff(oracle, swapBounds, seed()), "swapped-edge twin escaped");
  assert.ok(ramDiff(oracle, missToggle, seed()), "missing-toggle twin escaped");
  assert.ok(ramDiff(oracle, skipObjBFold, seed()), "skipped-object-fold twin escaped");
  console.log("  TEETH: row/col OR, guard, bounds, toggle and object-fold twins all caught");
});

// SPDX-License-Identifier: GPL-3.0-only
// Reduce the occupancy grid into summary cells: per-row and per-column ORs (each behind
// its always-empty guard cells), the pair of horizontal sweep bounds scanned inward from
// each end of the column summaries, and four region "clear" flags folded from the row
// summaries and two object-table columns.
import {
  OCCUPANCY_GRID, ROW_OCCUPANCY, COLUMN_OCCUPANCY, FORMATION_X_BOUNDS,
  OBJ_TABLE, loc_42b1, loc_4220, loc_4221, loc_4225, loc_4226,
} from "./names.js";

const ROWS = 6;
const COLS = 10;
const GRID_ROW_STRIDE = 16; // grid rows sit 16 bytes apart
const ROW_GUARD = 2;        // leading always-empty rows of the row table
const COL_GUARD = 3;        // leading always-empty columns of the column table

const FROM_RIGHT_BASE = 34;  // bound scanned from the rightmost column, stepped inward
const FROM_LEFT_BASE = 224;  // bound scanned from the leftmost column, stepped inward
const COLUMN_PITCH = 16;     // X step per skipped column

const OBJ_STRIDE = 32;   // bytes per object-table slot
const CLEAR_TOGGLE = 1;  // flips bit0 (any-occupied) into a region-clear flag

const gridCell = (r, c) => OCCUPANCY_GRID + r * GRID_ROW_STRIDE + c;
const columnOr = (c) => COLUMN_OCCUPANCY + COL_GUARD + c;

export function loc_098e(m) {
  const { mem8, mem16 } = m;

  // Per-row ORs behind their guard cells.
  for (let i = 0; i < ROW_GUARD; i++) mem8[ROW_OCCUPANCY + i] = 0;
  for (let r = 0; r < ROWS; r++) {
    let acc = 0;
    for (let c = 0; c < COLS; c++) acc |= mem8[gridCell(r, c)];
    mem8[ROW_OCCUPANCY + ROW_GUARD + r] = acc;
  }

  // Per-column ORs behind their guard cells.
  for (let i = 0; i < COL_GUARD; i++) mem8[COLUMN_OCCUPANCY + i] = 0;
  for (let c = 0; c < COLS; c++) {
    let acc = 0;
    for (let r = 0; r < ROWS; r++) acc |= mem8[gridCell(r, c)];
    mem8[columnOr(c)] = acc;
  }

  // Bound from the right end: scan inward from the rightmost column, one step per empty column.
  let fromRight = FROM_RIGHT_BASE, found = false;
  for (let c = COLS - 1; c >= 0; c--) {
    if (mem8[columnOr(c)] & 1) { found = true; break; }
    fromRight += COLUMN_PITCH;
  }
  if (!found) fromRight = FROM_RIGHT_BASE;

  // Bound from the left end: scan inward from the leftmost column, one step per empty column.
  let fromLeft = FROM_LEFT_BASE; found = false;
  for (let c = 0; c < COLS; c++) {
    if (mem8[columnOr(c)] & 1) { found = true; break; }
    fromLeft -= COLUMN_PITCH;
  }
  if (!found) fromLeft = FROM_LEFT_BASE;
  mem16[FORMATION_X_BOUNDS] = (fromLeft << 8) | fromRight; // low byte = from-right, high = from-left

  // Row flags: top four rows, then the whole grid.
  let rows = 0;
  for (let r = 0; r < 4; r++) rows |= mem8[ROW_OCCUPANCY + ROW_GUARD + r];
  mem8[loc_4221] = rows ^ CLEAR_TOGGLE;
  for (let r = 4; r < ROWS; r++) rows |= mem8[ROW_OCCUPANCY + ROW_GUARD + r];
  mem8[loc_4220] = rows ^ CLEAR_TOGGLE;

  // Object-table flags: seven slots of one field, then those OR an eight-slot field.
  let objs = 0;
  for (let i = 0; i < 7; i++) objs |= mem8[OBJ_TABLE + i * OBJ_STRIDE];
  mem8[loc_4226] = objs ^ CLEAR_TOGGLE;
  for (let i = 0; i < 8; i++) objs |= mem8[loc_42b1 + i * OBJ_STRIDE];
  mem8[loc_4225] = objs ^ CLEAR_TOGGLE;
}

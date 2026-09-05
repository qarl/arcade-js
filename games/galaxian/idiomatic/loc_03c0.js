// SPDX-License-Identifier: GPL-3.0-only
// Blank a run of VRAM columns: for each of `columns` columns, stamp the blank tile into three cells
// stepping up one row each, then advance to the next column (low byte only).
import { u16 } from "../../../core/int.js";
import { loc_5193 } from "./names.js";

const BLANK_TILE = 16;
const ROW_STEP = 32;         // one row up (VRAM stride)
const COLUMN_STEP = 98;      // low-byte advance to the next column
const ROWS_PER_COLUMN = 3;

export function loc_03c0(m, columns = m.regs.b) {
  const { mem8 } = m;
  let hl = loc_5193;
  let remaining = columns;

  do {
    for (let row = 0; row < ROWS_PER_COLUMN; row++) {
      mem8[hl] = BLANK_TILE;
      hl = u16(hl - ROW_STEP);
    }
    hl = ((hl >> 8) << 8) | ((hl + COLUMN_STEP) & 0xff); // next column: only the low byte advances
    remaining = (remaining - 1) & 0xff;                  // djnz wraps 0 -> 256 columns
  } while (remaining !== 0);
}

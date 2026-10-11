// SPDX-License-Identifier: GPL-3.0-only
/** plotPenCell — stamp the current glyph, and the current colour beside it, into the one character
 * cell that a row cell and a column cell name, and hand that cell's video-plane address back. Both
 * coordinates fold rather than run on: the row is scaled a byte at a time, so a row past the
 * thirty-second lands back at the top of the plane, and the column is added to the low half of the
 * address alone, so a column past the end of a row wraps within that row. The returned address is
 * load-bearing -- a caller steps a run of cells by subtracting a target from it.
 * LIVE-OUT: the two cells written, plus the address in HL and the colour in A.
 * ROM 0x026F-0x028F. Grounding: [seen] (names.js ROUTINES 0x026F). */

import { u8 } from "../../../core/int.js";
import { CHAR_PLANE_BASE, PEN_COLOUR, PEN_COLUMN_CELL, PEN_GLYPH, PEN_ROW_CELL } from "./names.js";

const COLOUR_PLANE_BIT = 0x400;
const CELLS_PER_ROW = 32;
const ROWS_BEFORE_FOLD = 32;

export function plotPenCell(m) {
  const { mem8 } = m;
  const rowStart = (mem8[PEN_ROW_CELL] & (ROWS_BEFORE_FOLD - 1)) * CELLS_PER_ROW;
  const cell = (CHAR_PLANE_BASE + (rowStart & ~0xff)) | u8(rowStart + mem8[PEN_COLUMN_CELL]);
  mem8[cell] = mem8[PEN_GLYPH];
  mem8[cell & ~COLOUR_PLANE_BIT] = mem8[PEN_COLOUR];
  // The plane address and the colour are live-outs: the ROM's callers read HL back and the colour
  // stays in A, so both are returned and left in those registers.
  return [m.regs.hl = cell, m.regs.a = mem8[PEN_COLOUR]];
}

// SPDX-License-Identifier: GPL-3.0-only
/** blankFourteenCharCells — blank a fourteen-cell run of the character plane and paint every one
 * of those cells the same colour. It starts at a fixed cell and walks a row at a time in the
 * direction that takes it back up the plane, so the whole run is decided here and no caller can
 * steer it. The run holds one column of the plane and varies the row, which is not the axis it
 * occupies on the glass; the name says how many cells, not where.
 *
 * ROM 0x07D2-0x07E5 (frozen lift translated/loc_07d2.js). Grounding: [seen] -- under MAME a write
 * tap gated to this routine's program counters found exactly 0xA79F - 0x20k for k = 0..13, each
 * written only with the blanking glyph, and in the colour plane only those cells' twins 0x400 below, each written with 0x16 (names.js).
 *
 * Role in the machine: a clean-up step run before the screen is redrawn. Its two callers are
 * blankCaptionThenAdvancePenRunStep and loadActivePlayerContextAndPostRoundHud, and each calls it
 * first, before doing anything else. The fixed start cell is KILL_METER_BAR_START_CELL (0xA79F), the
 * same cell drawKillMeter starts the kill-meter bar from, walking the same -0x20 stride.
 *
 * Under this board's ROT90 the native column it walks is a display ROW (names.js "why").
 *
 * LIVE-OUT: the twenty-eight cells written. */

import { u16 } from "../../../core/int.js";
import { KILL_METER_BAR_START_CELL } from "./names.js";

// Fourteen cells (ROM `ld b,0x0e` counts the djnz loop).
const CELLS = 14;
// One native row back: ROM `ld de,0xffe0`, i.e. -0x20, a row of 32 cells.
const ONE_ROW_BACK = -32;
// The blanking glyph the ROM writes into the character plane (`ld (hl),0xf1`).
const BLANK = 0xf1;
// The single colour every cell of the run is given (`ld (hl),0x16`).
const COLOUR = 0x16;
// Distance from a character-plane cell to its colour-plane twin: clearing this bit crosses to it.
const COLOUR_PLANE_BIT = 0x400;

export function blankFourteenCharCells(m) {
  const { mem8 } = m;
  let cell = KILL_METER_BAR_START_CELL;
  /* One pass per cell of the run. The character plane lives at 0xA400-0xA7FF and the colour plane
   * at 0xA000-0xA3FF, cell for cell at the same offset, so the ROM reaches a cell's colour byte by
   * clearing bit 10 of the address (`res 2,h`: 0xA7xx -> 0xA3xx) and comes back with `set 2,h`.
   * Here the cursor itself always stays in the character plane and the colour twin is derived from
   * it, which is the same pair of addresses. The cursor then steps one row back with `add hl,de`. */
  for (let i = 0; i < CELLS; i++) {
    mem8[cell] = BLANK;
    mem8[cell & ~COLOUR_PLANE_BIT] = COLOUR;
    cell = u16(cell + ONE_ROW_BACK);
  }
}

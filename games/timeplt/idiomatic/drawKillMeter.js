// SPDX-License-Identifier: GPL-3.0-only
/** drawKillMeter — repaint the meter that shows how many kills are still owed.
 *
 * The era selects a ten-byte row: the two glyphs the bar is built from, then eight end glyphs.
 * The low three bits of the count choose which end glyph, and the count divided by four — five
 * bits of that quotient — is how many bar cells are laid. Cells are laid from a fixed end of the
 * line with the two bar glyphs alternating, then the end glyph, then one blanking glyph, so the
 * bar shortens by a whole cell every four kills while the end glyph slides along with it and
 * covers the remainder. Only the glyph plane is written; nothing sets a colour, and nothing is
 * cleared beyond the single cell past the end glyph.
 * LIVE-OUT: memory only.
 *
 * ROM 0x0809-0x083D (frozen lift translated/loc_0809.js). Grounding: [seen] (names.js ROUTINES).
 *
 * ROLE IN THE MACHINE. KILLS_REMAINING (0xAD02) counts down the enemies still to destroy before
 * the Mother-Ship appears (56 at the start of every round), and the bar along the bottom of the
 * screen is a direct rendering of it (names.js) -- there is no time limit in this game; the bar is
 * this meter. It is repainted by postLifeStartCaptionsAndResetPlayfield each time a life opens
 * and also by serviceRoundThenResolvePlayerState.
 *
 * GEOMETRY. The bar starts at the fixed cell KILL_METER_BAR_START_CELL (0xA79F) and each further
 * cell is 32 addresses LOWER -- one row up in the native tilemap, which under the board's ROT90 is
 * one cell along a line on the glass.
 */

import { u16, u8 } from "../../../core/int.js";
import { ERA_INDEX, KILLS_REMAINING, KILL_METER_GLYPH_ROW_TABLE, KILL_METER_BAR_START_CELL } from "./names.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { offsetAddress } from "./offsetAddress.js";

const ROW_BYTES = 10;
const END_GLYPHS = 8;
const CELL_STEP = -32;
const KILLS_PER_CELL = 4;
const LONGEST_BAR = 31;
const BLANK_GLYPH = 241;

export function drawKillMeter(m) {
  const { mem8 } = m;
  // Pick this era's row of KILL_METER_GLYPH_ROW_TABLE (0x087C): ERA_INDEX times ten, built in the
  // ROM by doublings (`add a,a` x3 plus the saved x2) and added to the base by offsetAddress (rst
  // 0x18). The first two bytes are the glyphs the bar alternates between (ROM `ld b,(hl)` and
  // `ld c,(hl)`), so each era draws its meter in its own pieces.
  const row = offsetAddress(m, KILL_METER_GLYPH_ROW_TABLE, u8(ROW_BYTES * mem8[ERA_INDEX]));
  const barGlyphs = [mem8[row], mem8[u16(row + 1)]];

  // The end glyph: the count's low three bits index the eight glyphs after the bar pair (ROM
  // `and 0x07 / rst 0x08`). It is fetched now and parked in A' while the bar is laid.
  const owed = mem8[KILLS_REMAINING];
  const endGlyph = fetchTableByte(m, u16(row + 2), owed & (END_GLYPHS - 1));

  // The bar: count / 4 cells, kept to five bits (ROM `rrca / rrca / and 0x1f`), laid from the fixed
  // start cell one row up at a time, first-pair glyph, second-pair glyph, first again, and so on.
  // A count below four lays no bar cells at all (the ROM's `jr z,0x0838`).
  let cursor = KILL_METER_BAR_START_CELL;
  const cells = Math.floor(owed / KILLS_PER_CELL) & LONGEST_BAR;
  for (let cell = 0; cell < cells; cell++) {
    mem8[cursor] = barGlyphs[cell % 2];
    cursor = u16(cursor + CELL_STEP);
  }
  // Cap the bar: the end glyph in the next cell (ROM `ex af,af' / ld (hl),a` at 0x0838), then the
  // blank glyph 0xF1 one cell further (`ld (hl),0xf1`). The single blank is what erases the cell the
  // end glyph occupied before, since a count falling by one moves the end back by at most a cell.
  mem8[cursor] = endGlyph;
  cursor = u16(cursor + CELL_STEP);
  mem8[cursor] = BLANK_GLYPH;
}

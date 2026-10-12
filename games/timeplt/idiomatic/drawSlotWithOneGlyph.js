// SPDX-License-Identifier: GPL-3.0-only
/** drawSlotWithOneGlyph — write one caller-supplied glyph into the cell the cursor names, blank
 * the cell one place BACK from it, give both of those cells the caller's colour, and step the
 * cursor on to the next slot. Crossing into the colour plane and back is done by clearing and
 * then SETTING one bit of the address, so a cursor that has drifted off its own plane is snapped
 * onto it rather than returned to where it came from. LIVE-OUT: the four cells written, and the
 * stepped cursor handed back through retreatCharCursor.
 *
 * ROM 0x0E8D-0x0E9B (frozen lift translated/loc_0e8d.js). Grounding: [seen] (names.js ROUTINES).
 *
 * ROLE IN THE MACHINE. One of three slot painters that step the same character cursor:
 * paintDoubleTile fills both cells of a two-cell slot with glyphs and steps the cursor one row,
 * as this one does; paintQuadTile writes four (a two-by-two block) and steps it two rows; and this one uses only one cell and blanks the other half (0xF1). Among its callers is
 * drawCountAsPictogramStrip, which lays a row of such slots. The blank is the unused half of a
 * fixed-width slot, not leading-zero suppression.
 *
 * THE TWO PLANES. The board's character RAM is a glyph plane at 0xA400-0xA7FF and a colour plane
 * 0x400 below it at 0xA000-0xA3FF, cell for cell; so clearing address bit 0x400 (the ROM's
 * `res 2,h`) moves from a glyph cell to its colour cell and setting it (`set 2,h`) moves back.
 *
 * Parameters: `cell` is the cursor (the ROM's DE), `glyph` the glyph to show (B) and `colour` the
 * colour for both cells (C).
 */

import { u16 } from "../../../core/int.js";
import { retreatCharCursor } from "./retreatCharCursor.js";

const CHARACTER_PLANE_BIT = 0x400;
const BLANK = 0xf1;

export function drawSlotWithOneGlyph(m, cell = m.regs.de, glyph = m.regs.b, colour = m.regs.c) {
  const { mem8 } = m;
  // The glyph goes in the cursor's cell and the blank glyph in the cell one address below it (ROM
  // `ld (hl),b / dec hl / ld (hl),0xf1`).
  const neighbour = u16(cell - 1);
  mem8[cell] = glyph;
  mem8[neighbour] = BLANK;

  // Colour both cells: drop into the colour plane at the lower cell, write it, step up one and write
  // the other (ROM `res 2,h / ld (hl),c / inc hl / ld (hl),c`).
  const colourOfNeighbour = neighbour & ~CHARACTER_PLANE_BIT;
  mem8[colourOfNeighbour] = colour;
  const colourOfCell = u16(colourOfNeighbour + 1);
  mem8[colourOfCell] = colour;

  // Back to the glyph plane by SETTING the bit (ROM `set 2,h`), then step the cursor one row on to
  // the next slot (ROM `rst 0x28`, retreatCharCursor, +0x20), which is also the value returned.
  return retreatCharCursor(m, colourOfCell | CHARACTER_PLANE_BIT);
}

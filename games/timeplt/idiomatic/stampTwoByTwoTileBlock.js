// SPDX-License-Identifier: GPL-3.0-only
/** stampTwoByTwoTileBlock — stamp one two-cell-square emblem at the cursor, colour all four cells
 * walking back across the square, and leave the cursor past it.
 *
 * ROLE. Ring command 5's handler (names.js, word-table slot 5 at 0x0BBC) calls this to draw its row
 * of 2x2 reserve-ship emblems. The character plane (from 0xA400) holds one shape code per cell; the colour
 * plane sits a fixed 0x400 bytes below it (from 0xA000) with one colour byte per cell. The monitor
 * is rotated, so a line of text on the glass runs through the plane in steps of -0x20 (one native
 * row), and +/-1 is the same place on the neighbouring line (see advanceCharCursor).
 *
 * With the cursor at P, the four shape codes counted up from the caller's base B land as:
 *
 *     P     = B+3      P-0x20 = B+1        (the cursor's own line)
 *     P-1   = B+2      P-0x21 = B          (the neighbouring line)
 *
 * All four cells then take the same colour C in the colour plane, written in the reverse of the
 * order the shapes were (P-0x20, P-0x21, P-1, P). The cursor is stepped once after each pair of
 * shapes, so it comes out at P-0x40: two cells along, the width of the emblem, ready for the next.
 *
 * ROM 0x4DAF-0x4DCE (frozen lift translated/loc_4daf.js). Grounding: [seen] (names.js ROUTINES
 * 0x4daf). LIVE-OUT: memory, eight cells, and the stepped cursor, which is both kept in de and
 * returned.
 */

import { u16 } from "../../../core/int.js";
import { advanceCharCursor } from "./advanceCharCursor.js";

// Shape plane minus 0x400 = colour plane (ROM `ld hl,0xfc00 / add hl,de`, i.e. DE - 0x400).
const COLOUR_PLANE_GAP = 0x400;
// One native row of the plane is 32 cells (ROM `ld a,l / add a,0x20 / ld l,a`, carry into H).
const NEXT_LINE = 32;

export function stampTwoByTwoTileBlock(m, base = m.regs.b, colour = m.regs.c, cell = m.regs.de) {
  const { mem8 } = m;

  // First pair: B+3 at P, then B+2 at P-1 on the neighbouring line. The restart at 0x0020
  // (advanceCharCursor) then steps the cursor one cell along the line, from P-1 to P-0x21.
  mem8[cell] = base + 3;
  cell = u16(cell - 1);
  mem8[cell] = base + 2;
  cell = advanceCharCursor(m, cell);

  // Second pair: B at P-0x21, then B+1 at P-0x20, back on the cursor's own line.
  mem8[cell] = base;
  cell = u16(cell + 1);
  mem8[cell] = base + 1;

  // Take the colour cell under P-0x20 before the cursor moves on; the second step along the line
  // leaves the cursor at P-0x40, just past the emblem.
  let colourCell = u16(cell - COLOUR_PLANE_GAP);
  cell = advanceCharCursor(m, cell);

  // Colour the square walking back: P-0x20, P-0x21, then one native row on (+0x20) to P-1, and
  // the cell after it, P. Every cell gets the one colour byte C.
  mem8[colourCell] = colour;
  colourCell = u16(colourCell - 1);
  mem8[colourCell] = colour;
  colourCell = u16(colourCell + NEXT_LINE);
  mem8[colourCell] = colour;
  mem8[u16(colourCell + 1)] = colour;

  // Hand the stepped cursor back, both as the result and in DE as the ROM leaves it.
  return (m.regs.de = cell);
}

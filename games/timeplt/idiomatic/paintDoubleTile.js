// SPDX-License-Identifier: GPL-3.0-only
/** paintDoubleTile — lay down a two-cell mark at the cursor and step the cursor past it. The pair of codes is consecutive:
 * the caller supplies the lower and the upper is one on from it, the upper going into the cell the cursor names and
 * the lower into the cell one address before it. Both cells then get the caller's colour, reached by clearing one bit of the
 * address, and the cursor comes back across that bit before it steps. Where the borrow or the carry crosses a plane,
 * the cells the mark and the colour land in part company; the arithmetic is written out so that they can.
 *
 * ROM 0x0E9C-0x0EAB (frozen lift translated/loc_0e9c.js). Grounding: [seen] (names.js ROUTINES 0x0E9C).
 *
 * Role in the machine: one member of a family of pictogram painters named by BLOCK SIZE. Its caller
 * drawCountAsPictogramStrip (ring command 6, the round-number HUD) splits a count into thirties,
 * tens, fives and ones and paints a pictogram for each one of those; this two-tile block is the
 * one the count of FIVES drives. names.js records the check: posting command 6 with 37 dispatched this
 * routine exactly once, laying codes 0x32 and 0x33 with colour 0x11 a plane below.
 *
 * The screen: the character plane (glyphs, based at 0xA400) and the colour plane (based at 0xA000)
 * hold the same grid at the same offsets, told apart only by address bit 10 (0x0400).
 *
 * Parameters (and their ROM registers): `cursor` the character-plane cell to paint (DE — the ROM
 * swaps it into HL for the writes and back); `code` the lower code of the pair (B); `colour` the
 * colour byte for both cells (C).
 *
 * LIVE-OUT: memory, plus the stepped cursor. */

import { u16, u8 } from "../../../core/int.js";
import { retreatCharCursor } from "./retreatCharCursor.js";

// Address bit 10: set on the character plane, clear on the colour plane (the ROM's `res 2,h` / `set 2,h`).
const CHARACTER_PLANE_BIT = 0x400;

export function paintDoubleTile(m, cursor = m.regs.de, code = m.regs.b, colour = m.regs.c) {
  const { mem8 } = m;
  // The two glyphs (ROM `inc b / ld (hl),b / dec b / dec hl / ld (hl),b`): the code one on from the
  // caller's goes into the cell the cursor names, the caller's own code into the address one below.
  const below = u16(cursor - 1);
  mem8[cursor] = u8(code + 1);
  mem8[below] = code;

  // The colours (ROM `res 2,h / ld (hl),c / inc hl / ld (hl),c`): clear bit 10 on the LOWER address
  // to reach the colour plane, colour it, then colour the address one above. The two colour cells
  // are computed from the lower glyph cell rather than each from its own glyph, which is why a
  // borrow across a plane boundary could send glyphs and colours to different places.
  const colourCell = below & ~CHARACTER_PLANE_BIT;
  mem8[colourCell] = colour;
  mem8[u16(colourCell + 1)] = colour;

  // Back to the character plane (`set 2,h` — a set, so the cursor always ends on the glyph side),
  // then step the cursor with retreatCharCursor (the `rst 0x28` restart, +0x20: one character row on
  // in video RAM). The ROM reaches that restart by a call and returns straight after.
  return retreatCharCursor(m, u16(colourCell + 1) | CHARACTER_PLANE_BIT);
}

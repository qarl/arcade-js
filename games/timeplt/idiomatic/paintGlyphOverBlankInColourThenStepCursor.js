// SPDX-License-Identifier: GPL-3.0-only
/** paintGlyphOverBlankInColourThenStepCursor — lay a two-cell piece into the character plane at the cursor, then step the cursor
 * one place along the line. The cell the cursor names takes the caller's glyph; the address one
 * BELOW it takes the blanking glyph; and both take the caller's colour in the plane beside them.
 * Coming back from the colour plane is a SET, so the cursor is left on the glyph side whether or
 * not it arrived there, and one arriving on the colour side writes its glyph there instead. The
 * pointer the caller was holding is untouched.
 * The cursor is then stepped one cell on along the line (advanceCharCursor).
 *
 * ROM 0x4DCF-0x4DDD (frozen lift translated/loc_4dcf.js). Grounding: [seen] (names.js ROUTINES 0x4DCF).
 *
 * Role in the machine: one column of the two-cell slot that stampTwoByTwoTileBlock writes, with the
 * other cell of the slot blanked. Its one call site is the loop at 0x4D9A in
 * drawEmblemStripThenGuardImage (ring command 5, the reserve-ships HUD): after the emblems it clears
 * the rest of the row, from where the emblems end down to 0xA623, passing the blank glyph 0xF1 as the glyph — so
 * there BOTH cells come out blank. names.js records a MAME write tap of 126 dispatches, each a pair
 * one cell apart with the blank on the lower address.
 *
 * The screen: the character plane (glyphs, based at 0xA400) and the colour plane (based at 0xA000)
 * hold the same grid at the same offsets, told apart only by address bit 10 (0x0400).
 *
 * Parameters (and their ROM registers): `cursor` the character-plane cell (DE — the ROM swaps it
 * into HL for the writes and back, which is why the caller's HL survives); `glyph` the glyph for
 * the cursor's cell (B); `colour` the colour for both cells (C).
 *
 * LIVE-OUT: the four cells written and the stepped cursor, returned. */

import { u16 } from "../../../core/int.js";
import { advanceCharCursor } from "./advanceCharCursor.js";

// 0xF1 is the game's blank glyph: the power-on clear fills the whole character plane with it.
const BLANK_GLYPH = 241;
// Address bit 10: set on the character plane, clear on the colour plane.
const CHARACTER_PLANE_BIT = 0x400;

export function paintGlyphOverBlankInColourThenStepCursor(m, cursor = m.regs.de, glyph = m.regs.b, colour = m.regs.c) {
  const { mem8 } = m;
  // The glyph pair (ROM `ld (hl),b / dec hl / ld (hl),0xf1`): the caller's glyph at the cursor, the
  // blank glyph at the address one below — the unused half of the two-cell slot.
  mem8[cursor] = glyph;
  cursor = u16(cursor - 1);
  mem8[cursor] = BLANK_GLYPH;

  // The colours (ROM `res 2,h / ld (hl),c / inc hl / ld (hl),c / set 2,h`): drop to the colour plane
  // by clearing bit 10, colour the lower cell and the one above it, then SET bit 10 to come back —
  // which leaves the cursor on the glyph side whichever side it started on.
  cursor = cursor & ~CHARACTER_PLANE_BIT;
  mem8[cursor] = colour;
  cursor = u16(cursor + 1);
  mem8[cursor] = colour;
  cursor = cursor | CHARACTER_PLANE_BIT;

  // Step one cell on along the line: advanceCharCursor, the `rst 0x20` restart (-0x20, one
  // character row back in video RAM, which the rotated monitor shows as the next column).
  return advanceCharCursor(m, cursor);
}

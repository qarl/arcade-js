// SPDX-License-Identifier: GPL-3.0-only
/** paintUnsuppressedDigit — paint one decimal digit, with its colour, into the cell a cursor
 * names. Only the low four bits are used, and they index a glyph table; sixteen values can reach
 * it, which is more than it has entries, so the highest few land past its end. The glyph goes to
 * the cell, the caller's colour to the same cell in the plane beside it, and the cursor comes back
 * on the glyph side whether or not it arrived there. The run pointer the caller was walking is
 * saved across the lookup and handed back where it was.
 * LIVE-OUT: the two cells, and the cursor, returned. The ROM also leaves the colour in A, which no
 * caller reads (equivalence-0d90, DEAD AT EXIT).
 * ROM 0x0D90-0x0D9F. Grounding: [seen] (names.js ROUTINES 0x0D90). */

import { fetchTableByte } from "./fetchTableByte.js";
import { DIGIT_GLYPH_TABLE } from "./names.js";

const DIGIT_BITS = 0x0f;
const CHARACTER_PLANE_BIT = 1 << 10; // bit 10: character/attribute plane select

export function paintUnsuppressedDigit(m, value = m.regs.a, colour = m.regs.c, cell = m.regs.de) {
  const { mem8 } = m;
  const glyph = fetchTableByte(m, DIGIT_GLYPH_TABLE, value & DIGIT_BITS);

  mem8[cell] = glyph;
  mem8[cell & ~CHARACTER_PLANE_BIT] = colour;
  // hand back the cursor on the glyph side
  return (m.regs.de = cell | CHARACTER_PLANE_BIT);
}

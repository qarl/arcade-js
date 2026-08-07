// SPDX-License-Identifier: GPL-3.0-only
/** loc_0d90 — paint one hexadecimal digit, with its colour, into the cell a cursor names.
 *
 * Only the low four bits of the value arriving are used; a sixteen-entry table turns them into a
 * glyph code, so a value out of range cannot select anything outside the table. The glyph goes
 * to the cell, the caller's colour to the same cell in the plane beside it, and the cursor comes
 * back on the glyph side whether or not it arrived there. The run pointer the caller was walking
 * is saved across the lookup and handed back where it was.
 * LIVE-OUT: the two cells, the cursor, and the run pointer, unchanged. */

import { fetchTableByte } from "./fetchTableByte.js";

const GLYPHS = 0x0dcc;
const DIGIT_BITS = 0x0f;
const CHARACTER_PLANE_BIT = 0x0400;

export function loc_0d90(m) {
  const { regs, mem8 } = m;
  const runPointer = regs.hl;
  regs.hl = GLYPHS;
  regs.a = regs.a & DIGIT_BITS;
  const glyph = fetchTableByte(m);
  regs.hl = runPointer;

  mem8[regs.de] = glyph;
  mem8[regs.de & ~CHARACTER_PLANE_BIT] = regs.c;
  regs.de |= CHARACTER_PLANE_BIT;
}

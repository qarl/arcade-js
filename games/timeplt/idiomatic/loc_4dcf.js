// SPDX-License-Identifier: GPL-3.0-only
/** loc_4dcf — lay a two-cell piece into the character plane at the cursor, then step the cursor
 * one place along the line.
 *
 * The cell the cursor names takes the caller's glyph; the address one BELOW it takes the
 * blanking glyph; and both of those take the caller's colour in the plane beside them. Coming
 * back from the colour plane is a SET, so the cursor is left on the glyph side whether or not it
 * arrived there, and a cursor that arrives on the colour side writes its glyph there instead.
 * The pointer the caller was holding is untouched.
 * LIVE-OUT: the four cells written, and the stepped cursor. */

import { u16 } from "../../../core/int.js";
import { advanceCharCursor } from "./advanceCharCursor.js";

const BLANK_GLYPH = 241;
const CHARACTER_PLANE_BIT = 0x0400;

export function loc_4dcf(m) {
  const { regs, mem8 } = m;
  let cursor = regs.de;
  mem8[cursor] = regs.b;
  cursor = u16(cursor - 1);
  mem8[cursor] = BLANK_GLYPH;

  cursor = cursor & ~CHARACTER_PLANE_BIT;
  mem8[cursor] = regs.c;
  cursor = u16(cursor + 1);
  mem8[cursor] = regs.c;

  regs.de = cursor | CHARACTER_PLANE_BIT;
  advanceCharCursor(m);
}

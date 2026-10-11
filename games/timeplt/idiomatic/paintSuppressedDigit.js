// SPDX-License-Identifier: GPL-3.0-only
/** paintSuppressedDigit — paint one four-bit digit into the cell the cursor names, lay the caller's colour
 * beside it in the plane below, and leave the cursor snapped onto the character side.
 *
 * A digit only reaches the glyph table through an index, and the index is where the suppression
 * lives: a non-zero digit indexes by its own value AND steps a flag on, while a zero indexes
 * either the blank entry or entry zero depending on whether that flag is still clear. So the
 * flag separates the zeros ahead of the first significant digit from the zeros after it, and it
 * is the caller who owns the flag across a run of these. Which entry the blank is is not an
 * immediate here either; it is fetched from a byte of the program image.
 *
 * ROM 0x0DAF-0x0DCB (frozen lift translated/loc_0daf.js). Grounding: [seen] (names.js ROUTINES 0x0DAF).
 *
 * Role in the machine: the digit painter of the score readouts. Its caller is
 * paintTwoSuppressedDigitsFromByte, which feeds it the two nibbles of a packed-decimal byte; the
 * six-digit score and high-score fields are built from those pairs. A suppressed zero is painted as
 * a BLANK, so the field keeps its width — names.js records a MAME tap on which a value of ten
 * thousand read blank, 1, 0, 0, 0, 0. That is the difference from its twin
 * paintDigitDroppingLeadingZero, which drops a suppressed zero and takes no cell for it.
 *
 * The screen: the character plane (glyphs, based at 0xA400) and the colour plane (based at 0xA000)
 * hold the same grid at the same offsets, told apart only by address bit 10 (0x0400).
 *
 * Parameters: `value` the digit in its low nibble; `flag` the caller's "significant digit seen" flag
 * (0 = none yet); `colour` the colour byte; `cell` the character-plane cell to paint.
 *
 * LIVE-OUT: the two cells painted, and { flag, cell }: the flag and the cursor. The ROM also leaves
 * the colour in A, which no caller reads (equivalence-0daf, DEAD AT EXIT). */

import { u8 } from "../../../core/int.js";

import { fetchTableByte } from "./fetchTableByte.js";
import { DIGIT_GLYPH_TABLE, LEADING_ZERO_BLANK_GLYPH_INDEX } from "./names.js";

const CHARACTER_PLANE_BIT = 1 << 10; // bit 10: character/attribute plane select
// The ROM's `and 0x0f`: only the low nibble is the digit.
const LOW_NIBBLE = 0x0f;

export function paintSuppressedDigit(m, value = m.regs.a, flag = m.regs.b, colour = m.regs.c, cell = m.regs.de) {
  const { mem8 } = m;
  const digit = value & LOW_NIBBLE;

  // Choose the glyph-table entry.
  // - A non-zero digit (ROM 0x0DB3 `inc b`, then `jr 0x0dbe`) indexes by itself and steps the flag
  //   on, marking that a significant digit has now been painted.
  // - A zero (ROM 0x0DB6) first loads the byte at 0x3246 (LEADING_ZERO_BLANK_GLYPH_INDEX), the table
  //   index of the blank. `inc b / dec b` then tests the flag: while it is still clear the zero is
  //   a LEADING zero and keeps that blank index; once it is set, `xor a` makes the index 0, the
  //   entry for the glyph '0'.
  let entry, nextFlag = flag;
  if (digit !== 0) {
    nextFlag = u8(flag + 1);
    entry = digit;
  } else {
    entry = flag === 0 ? mem8[LEADING_ZERO_BLANK_GLYPH_INDEX] : 0;
  }

  // Look the entry up in the digit-glyph table at 0x0DCC (DIGIT_GLYPH_TABLE) through fetchTableByte
  // (`rst 0x08`); the ROM's `push hl` / `pop hl` around it keeps the caller's pointer.
  const glyph = fetchTableByte(m, DIGIT_GLYPH_TABLE, entry);
  // Glyph into the character cell (`ld (de),a`), colour into the same cell of the colour plane
  // by clearing bit 10 (`res 2,d / ld a,c / ld (de),a`).
  mem8[cell] = glyph;
  mem8[cell & ~CHARACTER_PLANE_BIT] = colour;
  // Hand back the flag and the cursor with bit 10 SET (`set 2,d`) — a set, so it ends on the glyph
  // side whichever side it came in.
  return { flag: (m.regs.b = nextFlag), cell: (m.regs.de = cell | CHARACTER_PLANE_BIT) };
}

// SPDX-License-Identifier: GPL-3.0-only
/** paintDigitDroppingLeadingZero — paint one digit, with its colour, into the cell a cursor names — or suppress it.
 *
 * Only the low four bits of the value arriving choose the shape, out of a table in the program
 * image. A value that is not zero always paints and spends the whole suppression allowance at
 * once, so nothing after it can be suppressed. A zero paints only when that allowance is already
 * spent; while it is not, nothing is painted, one unit of allowance goes, and the cursor steps
 * BACK one place — so a caller that steps forward after every digit leaves the blank occupying
 * no space at all. The run pointer the caller was walking is handed back where it was, and the
 * cursor, whenever a digit is painted, comes back on the glyph side of the two planes whether or not it arrived there.
 *
 * ROM 0x0EEB-0x0F05 (frozen lift translated/loc_0eeb.js). Grounding: [seen] (names.js ROUTINES 0x0EEB).
 *
 * Role in the machine: the digit painter behind the STAGE caption. drawRoundNumberCaption (ring
 * command 7) paints ROUND_NUMBER through it as two digits, so a leading zero is DROPPED — it takes
 * no cell, the surviving digit landing where the tens digit would have been — while a trailing zero
 * always shows. That is the difference from its twin paintSuppressedDigit, which paints a BLANK glyph
 * in a suppressed place and so keeps the field's width. names.js records the MAME write tap that
 * separates the two: stage 37 made two character writes, stage 7 made one.
 *
 * The screen: the character plane (glyphs, based at 0xA400) and the colour plane (based at 0xA000)
 * hold the same grid at the same offsets, told apart only by address bit 10 (0x0400). So one cursor
 * reaches both a cell's glyph and its colour by clearing or setting that bit.
 *
 * Parameters (with where their values come from in the ROM): `value` the digit in its low nibble (A);
 * `allowance` how many leading zeros may still be dropped (B), set by the caller before the run;
 * `colour` the colour byte (C); `cell` the cursor, the character-plane cell to paint (DE). The ROM
 * also saves and restores the caller's run pointer (HL) around the table lookup; nothing here
 * touches HL, so it is left exactly where the caller had it.
 *
 * LIVE-OUT: the two cells, and [allowance, cursor] returned (both also left in B and DE). */

import { u8 } from "../../../core/int.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { retreatCharCursor } from "./retreatCharCursor.js";
import { DIGIT_GLYPH_TABLE_2 } from "./names.js";

// The ROM's `and 0x0f`: only the low nibble picks a digit.
const DIGIT_BITS = 0x0f;
const CHARACTER_PLANE_BIT = 1 << 10; // bit 10: character/attribute plane select

export function paintDigitDroppingLeadingZero(m, value = m.regs.a, allowance = m.regs.b, colour = m.regs.c, cell = m.regs.de) {
  const { mem8 } = m;
  const digit = value & DIGIT_BITS;

  // The drop (ROM 0x0EFF-0x0F05: `ld a,b / and a / jr z` not taken, `dec b`, `rst 0x28`, `ret`).
  // A zero while allowance remains paints nothing at all. One unit of allowance is spent, and the
  // cursor is stepped one cell BACK (retreatCharCursor, the `rst 0x28` restart). The caller steps
  // it forward again after every digit, so the two steps cancel and the dropped zero takes no cell.
  if (digit === 0 && allowance !== 0) {
    const cursor = retreatCharCursor(m, cell);
    return [(m.regs.b = u8(allowance - 1)), cursor];
  }

  // The paint (ROM 0x0EF1-0x0EFE). Reached by a non-zero digit, which first zeroes the allowance
  // (`ld b,0x00` at 0x0EEF) so no later zero in the run can be dropped, or by a zero once the
  // allowance is already spent (B is then 0 already). The glyph comes from the second digit-glyph
  // table at 0x0F06 (DIGIT_GLYPH_TABLE_2), indexed by the digit through fetchTableByte (`rst 0x08`).
  const glyph = fetchTableByte(m, DIGIT_GLYPH_TABLE_2, digit);
  // Glyph into the character cell the cursor names (`ld (de),a`), then the caller's colour into the
  // same cell of the colour plane, reached by clearing bit 10 (`res 2,d` / `ld a,c` / `ld (de),a`).
  mem8[cell] = glyph;
  mem8[cell & ~CHARACTER_PLANE_BIT] = colour;
  // Hand back: the spent allowance, and the cursor with bit 10 SET (`set 2,d`) — a set, not a
  // restore, so the cursor ends on the glyph side whichever side it arrived on. (The ROM's `push hl`
  // / `pop hl` around the lookup has nothing to restore here: HL is never touched.)
  return [m.regs.b = 0, m.regs.de = cell | CHARACTER_PLANE_BIT];
}

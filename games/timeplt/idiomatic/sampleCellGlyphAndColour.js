// SPDX-License-Identifier: GPL-3.0-only
/**
 * sampleCellGlyphAndColour — take what is currently showing at one character cell, its glyph byte and
 * the colour byte of the same cell, and lay the two down side by side as a two-byte record.
 *
 * WHAT IT IS: ROM routine 0x1AFC [seen]. The glyph plane and the colour plane hold the same 32x32 grid
 * at the same offset and are told apart by a single address bit (bit 10, 0x400: glyph cells have it
 * set, their colour twins do not), so one pointer reaches both. The cell itself is not touched, so what
 * the caller gets is a reading, not a reservation.
 *
 * ROLE IN THE MACHINE: a SAMPLE, not a save-for-restore. stepCopyrightScreenAwaitingStart samples one
 * cell of the copyright line into a record every frame; watched, the glyph half stayed constant while
 * the colour half alternated between 0x05 and 0x10 -- the cell blinks under it and the copy tracks it
 * frame by frame. The only readers of that record are two comparisons inside
 * advancePlayerAnimationStrip, and nothing writes the pair back to any cell, which is what a restore
 * would have to do. parkSpritesAndArmLineWipeThenAdvanceSequence samples a second cell once; what reads
 * that record is unmeasured.
 *
 * PARAMETERS: `cell` is the cell's glyph-plane address (the ROM passes it in HL), `record` the two-byte
 * record to fill (DE).
 * LIVE-OUT: the two record bytes, plus the pointer left on the colour plane, the record cursor stepped
 * to the colour byte, and the colour byte in hand -- exactly the registers the ROM leaves behind.
 */

import { u16 } from "../../../core/int.js";

/** The single address bit separating a glyph cell from its colour twin (the ROM's `res 2,h`). */
const GLYPH_PLANE_BIT = 0x400;

export function sampleCellGlyphAndColour(m, cell = m.regs.hl, record = m.regs.de) {
  const { mem8 } = m;
  // Step 1: find the colour twin by clearing the plane bit, and the record's second byte.
  const colourCell = cell & ~GLYPH_PLANE_BIT;
  const next = u16(record + 1);
  // Step 2: the glyph byte into the record's first byte.
  mem8[record] = mem8[cell];
  // Step 3: the same cell's colour byte into the record's second byte.
  const colour = mem8[colourCell];
  mem8[next] = colour;
  // Leave the pointer on the colour plane, the record cursor on the pair's colour byte, and the colour in hand.
  return [(m.regs.hl = colourCell), (m.regs.de = next), (m.regs.a = colour)];
}

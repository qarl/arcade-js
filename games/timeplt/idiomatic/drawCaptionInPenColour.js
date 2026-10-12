// SPDX-License-Identifier: GPL-3.0-only
/** drawCaptionInPenColour — paint the caption a caller's index selects. A table of pointers turns
 * the index into a record; the record opens with the character cell the caption starts at and one
 * more byte, and the glyphs follow. That third byte is STEPPED OVER, not used: the colour every
 * cell gets is the low half of the current colour cell instead, so a caption's own record cannot
 * choose its colour.
 *
 * ROM 0x0C0F-0x0C21. Grounding: [seen] (names.js ROUTINES 0x0C0F).
 *
 * ROLE IN THE MACHINE. This is command 2's handler in the command ring ("caption in pen colour",
 * mechanisms.md §8): a sequence arm posts (2, caption index) and the foreground drain loop
 * dispatches it here through the handler table at 0x0BBC. The colour cell is PEN_COLOUR 0xAD0C
 * [seen], the active player's pen colour, which the era pen table sets to the era number plus
 * one -- so captions drawn this way (PLAYER n at each life start of a game, READY in the demo and on
 * a restart after a death (a round's first life posts the round-number caption, command 7, in
 * READY's place), and the flashing era year on its command-2 frames; GAME OVER is posted as command
 * 10, the +5 sibling) change colour from era to era. It is the +0 member of the caption family;
 * drawTextRunByIndex is the sibling that reads the byte this one steps over, which is what shows
 * that byte is the record's own colour (names.js).
 * PARAMETER: index = the caption number, the ring command's argument (the ROM's A).
 * LIVE-OUT: the cells painted, plus the cursor the painter leaves standing; both the colour used
 * (left in C) and that cursor are returned, as [colour, cursor]. */

import { u16 } from "../../../core/int.js";
import { drawTextRun } from "./drawTextRun.js";
import { fetchWideTableWord } from "./fetchWideTableWord.js";
import { PEN_COLOUR, CAPTION_RECORD_TABLE } from "./names.js";

// Low nibble of the pen colour (ROM `and 0x0f` at 0x0C1E). Clearing bit 4 also means these
// captions always draw in the under-sprite category (mechanisms.md §8, "Pens").
const COLOUR_FIELD = 0x0f;
// Record layout: start-cell word (2 bytes) + colour byte (1) -- the glyph run begins at +3.
const GLYPHS_START = 3;

export function drawCaptionInPenColour(m, index = m.regs.a) {
  const { mem8 } = m;
  // Index -> record, through CAPTION_RECORD_TABLE 0x0C50 (ROM `ld hl,0x0c50 / call 0x018c`).
  const record = fetchWideTableWord(m, CAPTION_RECORD_TABLE, index);
  // The colour comes from the pen cell, not from the record (ROM 0x0C1B-0x0C20).
  const colour = mem8[PEN_COLOUR] & COLOUR_FIELD;
  // Paint the glyph run from +3 at the record's start cell; the ROM enters drawTextRun (0x0BFF)
  // by a tail jump (`jr 0x0bff`).
  const cursor = drawTextRun(m, u16(record + GLYPHS_START), m.mem16[record], colour);
  return [(m.regs.c = colour), cursor];
}

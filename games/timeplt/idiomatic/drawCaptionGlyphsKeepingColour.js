// SPDX-License-Identifier: GPL-3.0-only
/** drawCaptionGlyphsKeepingColour — paint the glyphs of the caption an index selects and leave the colour plane alone. The index picks a
 * record out of the caption table; the record's first two bytes name the cell to start from and
 * the colour byte after them is stepped over unread. Each byte of the run that follows is copied
 * into the character plane, and the cursor steps one cell along the line after every one, until
 * the code that ends the run. A run that is empty writes nothing. Every cell keeps whatever colour
 * it already had. LIVE-OUT: memory only.
 *
 * ROM 0x0BDD-0x0BF1 (frozen lift loc_0bdd). Grounding: [code] (names.js ROUTINES 0x0BDD).
 *
 * Role in the machine: this is command 0 of the command ring -- word 0 of the handler table at
 * 0x0BBC. It is the same walk as eraseTextRunByIndex (command 3) except that it writes the glyph
 * it reads where the eraser writes the blank, and the same glyph-plane result as
 * drawTextRunByIndex (command 1) without that handler's colour writes. No poster in the image
 * puts command 0 on the ring, so in the running game this handler is never reached
 * (mechanisms.md, command ring).
 *
 * Caption records (CAPTION_RECORD_TABLE 0x0C50, a table of record addresses indexed by caption
 * number): each record is { start-cell word, colour byte, glyph run ending in 0xB9 }.
 *
 * Parameter: `caption` -- the caption number (A in the ROM; the ring's argument byte).
 */

import { u16 } from "../../../core/int.js";
import { advanceCharCursor } from "./advanceCharCursor.js";
import { fetchWideTableWord } from "./fetchWideTableWord.js";
import { CAPTION_RECORD_TABLE } from "./names.js";

const RUN_STARTS_AT = 3; // two-byte start cell + one colour byte, then the glyph run
const END_OF_TEXT = 185; // 0xB9: cp 0xb9 / ret z -- the run terminator

export function drawCaptionGlyphsKeepingColour(m, caption = m.regs.a) {
  const { mem8 } = m;
  /* Find the record: ld hl,0x0c50 / call 0x018c (fetchWideTableWord) returns the address stored
   * in entry `caption` of the caption table. */
  const record = fetchWideTableWord(m, CAPTION_RECORD_TABLE, caption);
  /* The record's first word is the video-RAM cell the caption starts at (ld e,(hl) / ld d,(hl)).
   * The ROM then steps HL three bytes on, over the colour byte, to the first glyph. */
  let cursor = m.mem16[record];
  let next = u16(record + RUN_STARTS_AT);
  /* Walk the run until the 0xB9 terminator. Each glyph is stored into the character plane as it
   * is read (ld a,(hl) / ld (de),a); the colour RAM is not touched. The cursor then moves one
   * cell along the line with rst 0x20 (advanceCharCursor, 32 bytes back in video RAM, one cell on
   * the rotated screen). */
  for (let glyph = mem8[next]; glyph !== END_OF_TEXT; glyph = mem8[next]) {
    mem8[cursor] = glyph;
    next = u16(next + 1);
    cursor = advanceCharCursor(m, cursor);
  }
}

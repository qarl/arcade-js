// SPDX-License-Identifier: GPL-3.0-only
/**
 * paintDeferredCells — paint a list of pending cell edits into the character plane and its colour plane.
 * The list is four-byte entries (colour-plane address, shape, colour); the pending count is the low half of
 * the list's own write cursor, so the whole list lives in one page and every cursor step wraps inside it. A
 * cursor still at the first entry means nothing is pending and it leaves at once. An entry whose colour cell
 * already has its high-priority bit set is passed over (a cell drawn above the sprites is never repainted
 * here); every other entry has its shape written to the character plane and its colour written back at the
 * address, with one shared bias added first, so the whole list re-tints together. LIVE-OUT: memory-only.
 *
 * ROM: 0x52D2. Tag [seen] (names.js). Role in the machine: the middle step of
 * drainBothDeferredCellLists, run at vertical blank. The player's shots are not hardware sprites;
 * queueTileStampForObject turns each shot into a two-by-two block of character cells and appends one entry
 * per cell whose glyph byte is not zero to the list behind DEFERRED_WRITE_CURSOR 0xAE00 [seen], entries starting at DEFERRED_WRITE_LIST
 * 0xAE04 [seen]. This routine is where those queued cells actually reach the screen; the step before it
 * blanks last pass's cells, and the step after copies this list onto the blank list for the next pass.
 */

import { u8 } from "../../../core/int.js";
import { DEFERRED_WRITE_CURSOR, DEFERRED_WRITE_LIST, PEN_COLOUR } from "./names.js";

const TINT_BIAS_BITS = 0x0f;
const ENTRY_BYTES = 4;
const HEADER_BYTES = 4;
const ENTRY_COUNT_BITS = 0x1f;
const ABOVE_SPRITES = 0x10;
const TO_CHARACTER_PLANE = 0x400;

/** Step the read cursor one byte on WITHOUT leaving its page — the low byte is dropped and the
 * carry never reaches the high byte. */
const nextByte = (cursor) => cursor - u8(cursor) + u8(cursor + 1);

export function paintDeferredCells(m) {
  const { mem8, mem16 } = m;
  // The shared tint: the low nibble of PEN_COLOUR 0xAD0C [seen], the live caption/pen colour
  // (ROM: ld a,(0xad0c) / and 0x0f). It is added to every entry's colour below.
  const bias = mem8[PEN_COLOUR] & TINT_BIAS_BITS;
  // How full the list is: the write cursor's low byte less the four-byte header the list starts
  // after (ROM: ld hl,(0xae00) / ld a,l / sub 4). Zero means the cursor never left 0xAE04 —
  // nothing queued this pass — and the ROM's `ret z` leaves without touching the screen.
  const filled = u8(u8(mem16[DEFERRED_WRITE_CURSOR]) - HEADER_BYTES);
  if (filled === 0) return;

  // Bytes to entries: the ROM rotates right twice and keeps five bits (rrca / rrca / and 0x1f).
  // The loop is a DJNZ, so a count that masks to zero would run 256 times, not none.
  let cursor = DEFERRED_WRITE_LIST;
  let left = Math.floor(filled / ENTRY_BYTES) & ENTRY_COUNT_BITS;
  do {
    // Bytes 0-1 of the entry: the cell's address in the colour plane (0xA000-based), low half first.
    const low = mem8[cursor];
    cursor = nextByte(cursor);
    const colourCell = low | (mem8[cursor] << 8);
    cursor = nextByte(cursor);
    // Bit 4 of a colour cell marks a character drawn above the sprites; such a cell is never
    // overwritten by a shot (ROM: ld a,(de) / and 0x10 / jr nz to the skip).
    if ((mem8[colourCell] & ABOVE_SPRITES) === 0) {
      // Byte 2, the shape: written to the same cell in the character plane, which sits 0x400
      // above the colour plane (ROM: set 2,d — bit 10 of the address).
      mem8[colourCell | TO_CHARACTER_PLANE] = mem8[cursor];
      cursor = nextByte(cursor);
      // Byte 3, the colour: back in the colour plane (res 2,d), with the pen tint added and
      // wrapped to a byte (add a,c).
      mem8[colourCell] = u8(mem8[cursor] + bias);
      cursor = nextByte(cursor);
    } else {
      // Skipped entry: step over its shape and colour bytes so the next entry lines up.
      cursor = nextByte(nextByte(cursor));
    }
    left = u8(left - 1);
  } while (left !== 0);
}

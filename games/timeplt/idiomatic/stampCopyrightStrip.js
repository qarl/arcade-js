// SPDX-License-Identifier: GPL-3.0-only
/** stampCopyrightStrip — park the four pieces of one fixed caption strip in the display list.
 * Four consecutive object entries are filled entirely from constants: a shared position on one
 * axis and a shared control byte, shapes counting up from the first, and positions on the other
 * axis stepping one piece-width apart so the pieces butt together into a single strip. Each
 * entry is split across two halves a fixed distance apart, which is why every piece takes two
 * writes on each side. Nothing is read and nothing branches, so the same sixteen bytes land on
 * every call and a second call changes nothing the first did not.
 *
 * ROM 0x0B06-0x0B2A (frozen lift translated/loc_0b06.js). Grounding: [seen].
 *
 * Role in the machine: the strip is the copyright caption drawn in sprites — the shapes it places
 * decode out of the sprite ROM as a copyright mark and then KO, NA, MI. The attract sequence's
 * title and copyright steps call it, and re-stamp it every frame while they hold the copyright
 * screen (mechanisms.md, phase 1 and the credit-wait steps). When a game begins,
 * hideCaptionSprites zeroes the vertical byte of exactly these four entries to park them off
 * screen.
 *
 * ★ This routine's own code bytes are also data: guardBlockOrBlankDisplay folds 51 bytes starting
 * at 0x0B06 (stampCopyrightStrip_ADDR) onto COPYRIGHT_STRIP_CHECK_SEED as an anti-tamper checksum,
 * and blanks the display if the total is wrong — so a patched copyright strip turns the picture
 * off.
 *
 * LIVE-OUT: memory only. */

import { PLAYER_ENTRY } from "./names.js";
// The strip occupies the first four sprite entries of the display list, starting at PLAYER_ENTRY
// 0xAA10 (slot 0's entry); each entry is two bytes, so the next piece is two bytes on.
const PIECES = 4;
const ENTRY_STRIDE = 2;
// Sprite-entry layout (mechanisms.md): +0x00 one screen coordinate, +0x01 the shape (sprite code);
// the parallel table 0x30 bytes further on holds +0x30 the attribute (colour and flip) and +0x31
// the other screen coordinate.
const SHAPE = 1;
const ATTRIBUTE = 48;
const SECOND_AXIS = 49;

// The constants the ROM loads: coordinate 0xD8 at +0x00 for every piece (`ld e,0xd8`),
// attribute 0x6C (`ld (iy+0x30),0x6c`), shapes 4-7 (`ld c,0x04` then `inc c`), and the other
// coordinate starting at 0xA0 and dropping by 0x10 per piece (`ld d,0xa0`, `sub 0x10`) — sixteen
// pixels being one sprite's width, so the four pieces abut.
const FIXED_AXIS_VALUE = 216;
const ATTRIBUTE_VALUE = 108;
const FIRST_SHAPE = 4;
const LEADING_EDGE = 160;
const PIECE_PITCH = 16;

export function stampCopyrightStrip(m) {
  const { mem8 } = m;
  // One pass per piece (the ROM's `djnz` over B = 4, with IY stepping two bytes each time).
  for (let piece = 0; piece < PIECES; piece++) {
    const entry = PLAYER_ENTRY + piece * ENTRY_STRIDE;
    // First half of the entry: the shared coordinate and this piece's shape.
    mem8[entry] = FIXED_AXIS_VALUE;
    mem8[entry + SHAPE] = FIRST_SHAPE + piece;
    // Second half, 0x30 bytes on: the shared attribute and the coordinate that spaces the pieces
    // one sprite-width apart, so the four glyphs read as one continuous caption.
    mem8[entry + ATTRIBUTE] = ATTRIBUTE_VALUE;
    mem8[entry + SECOND_AXIS] = LEADING_EDGE - piece * PIECE_PITCH;
  }
}

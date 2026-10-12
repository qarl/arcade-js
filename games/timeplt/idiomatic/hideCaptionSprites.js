// SPDX-License-Identifier: GPL-3.0-only
/** hideCaptionSprites — clear one byte in each of four slots, evenly spaced two apart from a fixed first
 * one. The run is chosen here and a caller cannot redirect it; whatever those four bytes held is
 * discarded unread, so this clears rather than steps. LIVE-OUT: those four bytes.
 *
 * ROM 0x0B2B-0x0B38 (frozen lift translated/loc_0b2b.js): `ld hl,0xaa41 / ld de,0x0002 / ld b,0x04 /
 * xor a`, then a `ld (hl),a / add hl,de / djnz` loop. Grounding: [seen] (names.js ROUTINES 0x0b2b:
 * "park the four sprites of the copyright caption off the visible picture by zeroing the
 * native-Y byte of each, leaving the rest of their slots standing").
 *
 * Role in the machine: the attract screens put the "(c) KONAMI" copyright caption up as four sprites,
 * stamped by stampCopyrightStrip into the first four sprite entries. When a game begins those four have
 * to go. Zeroing an entry's native-Y byte parks it off the visible picture, so publishSpriteShadow's
 * next copy into the hardware banks hides it. Under MAME the four bytes went from the stamped ladder to
 * all zero on the frame a start press raised PLAY_ACTIVE (names.js "why").
 *
 * It is the four-slot sibling of hideAllSprites, which runs the identical idiom over all 24 entries.
 */

import { PLAYER_SPRITE_Y } from "./names.js";
// The native-Y bytes of consecutive entries are two apart (the ROM adds DE = 2 each turn).
const SLOT_STRIDE = 2;
// The caption is four sprites (the ROM's `ld b,0x04`).
const SLOTS = 4;

export function hideCaptionSprites(m) {
  const { mem8 } = m;
  // Zero the native-Y byte of each of the first four entries, starting at PLAYER_SPRITE_Y 0xAA41 [seen]:
  // 0xAA41, 0xAA43, 0xAA45, 0xAA47.
  for (let i = 0; i < SLOTS; i++) mem8[PLAYER_SPRITE_Y + i * SLOT_STRIDE] = 0;
}

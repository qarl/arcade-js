// SPDX-License-Identifier: GPL-3.0-only
/** hideAllSprites — sweep every sprite off the picture at once. Every slot the display
 * scans carries a native-Y position (the display's horizontal under ROT90), and this zeros all
 * of them; zero puts a slot outside the drawn native lines (above the first when upright, below
 * the last when turned round), clear of the picture entirely, so nothing of it appears. Every
 * other byte of a slot stands, so none is
 * retired. LIVE-OUT: memory only — 24 bytes, evenly spaced and all inside one page.
 *
 * ROM 0x15B6-0x15C1 (frozen lift translated/loc_15b6.js): `ld hl,0xaa41 / ld b,0x18 / xor a`, then
 * a `ld (hl),a / inc l / inc l / djnz` loop. Grounding: [seen] (names.js ROUTINES 0x15b6).
 *
 * Role in the machine: the blunt "clear the stage" tool used between scenes (mechanisms.md: "Hiding is
 * a separate and blunter tool"). It works on the sprite-entry SHADOW, not on the
 * hardware banks: once per frame publishSpriteShadow copies the shadow into the two hardware sprite
 * banks, so zeroed shadow bytes become hidden sprites on the next publish. No object record is touched,
 * so an object's own state survives; it is simply not visible until something rewrites its Y byte.
 * Callers include the phase-2 step 0 (parkSpritesAndArmLineWipeThenAdvanceSequence), the free-play
 * start in advanceAttractTowardGameStart, loseLifeAndHandOver and the initials-entry screen.
 *
 * Its four-slot sibling hideCaptionSprites uses the identical idiom on the copyright caption's slots
 * alone -- one routine hiding a caption, this one hiding everything (names.js "why").
 */

import { PLAYER_SPRITE_Y } from "./names.js";
// 24 sprite entries -- the whole shadow the renderer scans (the ROM's `ld b,0x18`).
const SLOT_COUNT = 24;
// Entries are two bytes apart in this band; the ROM steps with two `inc l`s.
const SLOT_STRIDE = 2;

export function hideAllSprites(m) {
  const { mem8 } = m;
  // Walk the band of native-Y (+0x31) bytes that begins at PLAYER_SPRITE_Y 0xAA41 [seen] and write
  // zero into each. The ROM steps only the LOW byte of the pointer (`inc l`), which is harmless
  // because the 24 bytes 0xAA41..0xAA6F all sit inside page 0xAA -- so a plain add is the same.
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    mem8[PLAYER_SPRITE_Y + slot * SLOT_STRIDE] = 0;
  }
}

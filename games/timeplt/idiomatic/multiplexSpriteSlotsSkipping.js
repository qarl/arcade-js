// SPDX-License-Identifier: GPL-3.0-only
/** multiplexSpriteSlotsSkipping — scanline-gated position fixup over eight sprite slots. Each slot pairs a Y byte in
 * one sprite bank with the X byte at the matching offset in the other. A slot acts only while its Y
 * byte has bit 7 set and adding the live scanline counter to it carries out of the top; on that
 * trigger the Y byte's bit 7 is cleared, quieting the slot, and the X byte's bit 7 is toggled.
 * LIVE-OUT: the touched sprite bytes. The ROM leaves A, C and the flags as the last slot set them, but
 * no caller reads them (equivalence-0f97, DEAD AT EXIT). A plain return: the stack is left exactly
 * where it was found.
 *
 * ROM 0x0F97-0x1097 (frozen lift translated/loc_0f97.js): eight unrolled blocks, one per scenery
 * sprite. Grounding: [seen] (names.js ROUTINES 0x0f97).
 *
 * Role in the machine: the OPPORTUNISTIC sprite-doubling pass. Time Pilot shows each of its eight
 * scenery-fed hardware sprites (0-2 and 19-23) twice per frame by moving it half the coordinate range
 * once the raster has drawn it at its first position (mechanisms.md, sprite doubling). A sprite's
 * request is bit 7 of its Y byte, set by publishSpriteShadow's copy into the hardware banks. The round
 * engine runs this pass five times at points spread through its service list: a sprite whose line the
 * beam has already passed is traded now, and one whose line has not come is left armed for a later
 * pass. multiplexSpriteSlots is the waiting pass that closes the list.
 *
 * Why it must go by the raster: the trade is due once SCANLINE_COUNTER (0xC000 read side) plus the Y
 * byte carries out of eight bits -- once the counter has reached 256 minus the Y byte, a line that
 * depends on where the sprite sits. Trading earlier would move the sprite before its first appearance
 * is drawn.
 */

import {
  SCANLINE_COUNTER,
  SPRITE_BANK1_SLOT0_Y, SPRITE_BANK0_BASE,
  SPRITE_BANK1_SLOT1_Y, SPRITE_BANK0_SLOT1_X,
  SPRITE_BANK1_SLOT2_Y, SPRITE_BANK0_SLOT2_X,
  SPRITE_BANK1_SLOT19_Y, SPRITE_BANK0_SLOT19_X,
  SPRITE_BANK1_SLOT20_Y, SPRITE_BANK0_SLOT20_X,
  SPRITE_BANK1_SLOT21_Y, SPRITE_BANK0_SLOT21_X,
  SPRITE_BANK1_SLOT22_Y, SPRITE_BANK0_SLOT22_X,
  SPRITE_BANK1_SLOT23_Y, SPRITE_BANK0_SLOT23_X,
} from "./names.js";

const REQUEST_BIT = 0x80;
const DISARM_MASK = 0x7f;
const TOGGLE_X_BIT7 = 0x80;
const BYTE_RANGE = 256;

// [Y byte, X byte] for each of the eight slots this pass covers.
const SLOTS = [
  [SPRITE_BANK1_SLOT0_Y, SPRITE_BANK0_BASE],
  [SPRITE_BANK1_SLOT1_Y, SPRITE_BANK0_SLOT1_X],
  [SPRITE_BANK1_SLOT2_Y, SPRITE_BANK0_SLOT2_X],
  [SPRITE_BANK1_SLOT19_Y, SPRITE_BANK0_SLOT19_X],
  [SPRITE_BANK1_SLOT20_Y, SPRITE_BANK0_SLOT20_X],
  [SPRITE_BANK1_SLOT21_Y, SPRITE_BANK0_SLOT21_X],
  [SPRITE_BANK1_SLOT22_Y, SPRITE_BANK0_SLOT22_X],
  [SPRITE_BANK1_SLOT23_Y, SPRITE_BANK0_SLOT23_X],
];

// Service one slot. ROM per block: `ld a,(Y) / bit 7,a` tests the request; `ld c,a / ld a,(0xC000) /
// add a,c` adds the live raster count to the Y byte, and a carry out of eight bits means the beam has
// passed this sprite's line; then the Y byte loses bit 7 (`and 0x7f`) and the X byte's bit 7 toggles
// (`add a,0x80`).
function serviceSlot(m, yAddr, xAddr) {
  const { mem8 } = m;
  const y = mem8[yAddr];
  if ((y & REQUEST_BIT) === 0) return; // slot idle
  if (mem8[SCANLINE_COUNTER] + y < BYTE_RANGE) return; // beam not past the trigger line yet
  mem8[yAddr] = y & DISARM_MASK;
  mem8[xAddr] = mem8[xAddr] + TOGGLE_X_BIT7;
  if (m.beamPlan) m.beamPlan.push({ y: yAddr, x: xAddr }); // record for the beam-sync render
}

export function multiplexSpriteSlotsSkipping(m) {
  for (const [yAddr, xAddr] of SLOTS) serviceSlot(m, yAddr, xAddr);
}

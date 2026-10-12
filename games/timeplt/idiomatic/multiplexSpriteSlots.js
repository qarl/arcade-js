// SPDX-License-Identifier: GPL-3.0-only
/** multiplexSpriteSlots — give eight display-list slots a second appearance half a screen away: where
 * a slot's request bit (high bit of its first byte) is set, the pair trades half a byte range so the
 * slot moves to the far half; a slot with no request is untouched. Each relocation is recorded in
 * m.beamPlan so the beam-sync render can repaint the first appearance in its band. LIVE-OUT: memory, m.beamPlan.
 *
 * ROM 0x1098-0x1198 (frozen lift translated/loc_1098.js): eight identical 32-byte blocks, one per
 * scenery sprite. Grounding: [seen] (names.js ROUTINES 0x1098: "wait until the raster has passed each of
 * eight scenery slots, then move that slot half a screen in both axes so the same sprite shows twice in
 * one frame; a slot whose request bit is clear is left alone").
 *
 * Role in the machine: 24 hardware sprites are not enough for the player, the enemies and the clouds,
 * so the eight scenery-fed sprites (hardware sprites 0-2 and 19-23) are each shown twice per frame by
 * moving them while the picture is being scanned out (mechanisms.md, sprite doubling). The request is
 * bit 7 of the sprite's Y byte in hardware bank 1, set by publishSpriteShadow's copy. This is the
 * CLOSING, waiting pass: the round engine (serviceRoundThenResolvePlayerState) and the life-start hold and
 * lead-in arms run it at the end of their service lists, after the opportunistic passes of
 * multiplexSpriteSlotsSkipping.
 *
 * The wait: in the ROM each block spins on SCANLINE_COUNTER (0xC000), adding the request byte to it
 * until the sum carries out of eight bits -- until the raster has reached the line that depends on
 * where the sprite sits -- and then trades, so the first appearance is already drawn when the sprite
 * moves. This port does not spin on a raster; it makes every requested trade at once and records it
 * in m.beamPlan (opened by the machine's startBeamFrame) for the beam-sync render instead. The bytes
 * that land in memory are the ROM's.
 */

import {
  SPRITE_BANK1_SLOT0_Y, SPRITE_BANK0_BASE,
  SPRITE_BANK1_SLOT1_Y, SPRITE_BANK0_SLOT1_X,
  SPRITE_BANK1_SLOT2_Y, SPRITE_BANK0_SLOT2_X,
  SPRITE_BANK1_SLOT19_Y, SPRITE_BANK0_SLOT19_X,
  SPRITE_BANK1_SLOT20_Y, SPRITE_BANK0_SLOT20_X,
  SPRITE_BANK1_SLOT21_Y, SPRITE_BANK0_SLOT21_X,
  SPRITE_BANK1_SLOT22_Y, SPRITE_BANK0_SLOT22_X,
  SPRITE_BANK1_SLOT23_Y, SPRITE_BANK0_SLOT23_X,
} from "./names.js";

// The eight (request, partner) pairs in ROM order: hardware sprites 0, 1, 2, then 19..23. The request
// is the sprite's Y byte in bank 1 (0xB411...), the partner its X byte in bank 0 (0xB010...).
const SPLIT_SLOTS = [
  { request: SPRITE_BANK1_SLOT0_Y, partner: SPRITE_BANK0_BASE },
  { request: SPRITE_BANK1_SLOT1_Y, partner: SPRITE_BANK0_SLOT1_X },
  { request: SPRITE_BANK1_SLOT2_Y, partner: SPRITE_BANK0_SLOT2_X },
  { request: SPRITE_BANK1_SLOT19_Y, partner: SPRITE_BANK0_SLOT19_X },
  { request: SPRITE_BANK1_SLOT20_Y, partner: SPRITE_BANK0_SLOT20_X },
  { request: SPRITE_BANK1_SLOT21_Y, partner: SPRITE_BANK0_SLOT21_X },
  { request: SPRITE_BANK1_SLOT22_Y, partner: SPRITE_BANK0_SLOT22_X },
  { request: SPRITE_BANK1_SLOT23_Y, partner: SPRITE_BANK0_SLOT23_X },
];

// Half the byte range: the request bit's weight, and the distance the sprite is moved.
const HALF_RANGE = 128;

export function multiplexSpriteSlots(m) {
  const { mem8 } = m;
  for (const slot of SPLIT_SLOTS) {
    // No request (top bit clear): the ROM's `bit 7,a / jr z` passes to the next block untouched.
    const request = mem8[slot.request];
    if (request < HALF_RANGE) continue;
    // The trade: `and 0x7f` clears the request (taking 128 off Y) and `add a,0x80` adds 128 to X,
    // wrapping in eight bits -- the same sprite, again, half the range away on both axes.
    mem8[slot.request] = request - HALF_RANGE;
    mem8[slot.partner] = mem8[slot.partner] + HALF_RANGE;
    // Tell the beam-sync render which pair moved, so it can draw the first appearance in its band.
    if (m.beamPlan) m.beamPlan.push({ y: slot.request, x: slot.partner });
  }
}

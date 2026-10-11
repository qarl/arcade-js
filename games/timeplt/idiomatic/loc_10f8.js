// SPDX-License-Identifier: GPL-3.0-only
/** loc_10f8 — give five display-list slots a second appearance, half a screen away.
 *
 * A slot is a pair of bytes and the high bit of the first one is a request. Where it is set the
 * pair trades half a byte range: the requester gives that half up and the partner takes it on,
 * which is what carries the slot into the far half of the display. A slot with no request is
 * stepped over, not stopped at, so a gap in the middle costs the slots after it nothing.
 * The hold that belongs before each trade is not reproduced; the same bytes land either way.
 * LIVE-OUT: memory only.
 *
 * ROM 0x10F8-0x1198 (frozen lift translated/loc_10f8.js): the last five of multiplexSpriteSlots' eight
 * identical 32-byte blocks, one per hardware sprite 19..23. Grounding: [seen] (names.js ROUTINES 0x10f8).
 *
 * Role in the machine: Time Pilot has 24 hardware sprites, too few for the player, the enemies and a
 * sky full of clouds, so the eight scenery sprites (0-2 and 19-23) are each shown twice per frame by
 * moving them while the picture is being scanned out (mechanisms.md, sprite doubling). This entry is the
 * waiting pass for sprites 19-23 only: spinRemainingSpriteMultiplexSlots (0x10FD) rejoins it here when
 * sprite 19's line has not come yet, and multiplexSpriteSlots' own pass runs straight through it.
 *
 * Why it keeps a hex name: no call or jump in the image targets 0x10F8 -- only relative branches
 * interior to multiplexSpriteSlots land here, so what the body does is a stretch of that routine's job
 * rather than a job of its own (names.js "why").
 *
 * What "the hold" is: in the ROM each block first spins -- re-reading SCANLINE_COUNTER (0xC000) and
 * adding the request byte to it until the sum carries out of eight bits, i.e. until the raster reaches
 * the line where the sprite has already been drawn once -- and only then trades. Each block also runs a
 * net-zero `inc hl / inc hl / dec hl / dec hl` as a pure delay. Neither changes a byte of memory, so
 * neither appears here.
 */

import {
  SPRITE_BANK1_SLOT19_Y, SPRITE_BANK0_SLOT19_X,
  SPRITE_BANK1_SLOT20_Y, SPRITE_BANK0_SLOT20_X,
  SPRITE_BANK1_SLOT21_Y, SPRITE_BANK0_SLOT21_X,
  SPRITE_BANK1_SLOT22_Y, SPRITE_BANK0_SLOT22_X,
  SPRITE_BANK1_SLOT23_Y, SPRITE_BANK0_SLOT23_X,
} from "./names.js";

// The five (request, partner) pairs this stretch covers, hardware sprites 19..23 in ROM order. The
// request is the sprite's Y byte in hardware sprite bank 1 (top bit = request); the partner is the same
// sprite's X byte in bank 0 (names.js: "multiplex pair").
const SPLIT_SLOTS = [
  { request: SPRITE_BANK1_SLOT19_Y, partner: SPRITE_BANK0_SLOT19_X },
  { request: SPRITE_BANK1_SLOT20_Y, partner: SPRITE_BANK0_SLOT20_X },
  { request: SPRITE_BANK1_SLOT21_Y, partner: SPRITE_BANK0_SLOT21_X },
  { request: SPRITE_BANK1_SLOT22_Y, partner: SPRITE_BANK0_SLOT22_X },
  { request: SPRITE_BANK1_SLOT23_Y, partner: SPRITE_BANK0_SLOT23_X },
];

// Half the byte range: the request bit's weight, and the distance the sprite is moved.
const HALF_RANGE = 128;

export function loc_10f8(m) {
  const { mem8 } = m;
  for (const slot of SPLIT_SLOTS) {
    // A clear top bit means no request: the ROM's `bit 7,a / jr z` skips to the next block.
    const request = mem8[slot.request];
    if (request < HALF_RANGE) continue;
    // The trade. `and 0x7f` clears the request bit -- which is also taking 128 off the Y byte -- and
    // `add a,0x80` adds 128 to the X byte (wrapping in eight bits). The sprite is thereby shown again
    // half the byte range away on both axes.
    mem8[slot.request] = request - HALF_RANGE;
    mem8[slot.partner] = mem8[slot.partner] + HALF_RANGE;
    // Tell the beam-sync render which pair moved, so it can draw the first appearance in its band.
    if (m.beamPlan) m.beamPlan.push({ y: slot.request, x: slot.partner });
  }
}

// SPDX-License-Identifier: GPL-3.0-only
/** spinRemainingSpriteMultiplexSlots — a subroutine entry into the five-slot display pass, entered
 * inside the first slot.
 *
 * ROLE. Time Pilot shows some hardware sprites twice per frame (the sprite multiplex): a request
 * bit (bit 7) in a sprite's bank-1 Y byte asks for it, and once the raster (SCANLINE_COUNTER,
 * 0xC000) has passed that sprite's line the pair "trades" -- the request is cleared from the Y byte
 * and 128, half the coordinate range, is added to the partner bank-0 X byte, so the same sprite is
 * drawn again half the range away further down the frame. The waiting pass for hardware sprites
 * 19-23 is one 32-byte block per sprite (ROM 0x10F8 onward, loc_10f8). This routine is the ROM
 * entry at 0x10FD, five bytes into sprite 19's block, just past the block's own `ld a,(Y) / bit 7,a`:
 * the caller arrives with a byte already held and already tested, and both are used as if that
 * block had loaded and tested sprite 19's Y byte itself. `firstSlotRequested` is that test; it
 * defaults to true because the one call site is a CALL NZ, which enters only with the test set.
 *
 *  - No request: sprite 19 is stepped over (ROM `jr z,0x1118`).
 *  - Otherwise the held byte is the request; if the raster has come (held + raster carries past
 *    255) sprite 19 trades from the held byte. If it has not, the ROM jumps back to the head of the
 *    block (0x10F8) -- here, the whole five-slot pass restarts via loc_10f8 and re-reads every slot.
 *  - Sprites 20-23 then trade wherever their own top bit is set.
 *
 * The ROM spins on the raster before each trade (and pads with a net-zero `inc hl/inc hl/dec hl/
 * dec hl` delay); that hold is not reproduced here -- the same bytes land either way.
 * The only CALL to this entry in the image, the CALL NZ at 0x15D9, sits in caption record 5
 * (0x15D6), whose bytes run as code only on the anti-tamper derail into 0x15CA at 0x17A6; the body itself is shared with
 * multiplexSpriteSlots, whose closing pass runs 0x10FD onward every time (mechanisms.md §9).
 *
 * ROM 0x10FD-0x1198 (frozen lift translated/loc_10fd.js). Grounding: [code], anti-tamper entry
 * (names.js ROUTINES 0x10fd, grounding-debt.txt). LIVE-OUT: memory only.
 * Kept as the ROUTINES override of 0x10FD: no idiomatic module calls
 * it, because its only CALL (0x15D9) runs only on a tampered image (grounding-debt.txt 0x10fd).
 */

import { loc_10f8 } from "./loc_10f8.js";
import { SPRITE_BANK1_SLOT19_Y, SPRITE_BANK0_SLOT19_X, SCANLINE_COUNTER, SPRITE_BANK1_SLOT20_Y, SPRITE_BANK0_SLOT20_X, SPRITE_BANK1_SLOT21_Y, SPRITE_BANK0_SLOT21_X, SPRITE_BANK1_SLOT22_Y, SPRITE_BANK0_SLOT22_X, SPRITE_BANK1_SLOT23_Y, SPRITE_BANK0_SLOT23_X } from "./names.js";

// Half of a byte's range: the request bit's weight, and the offset added to the partner X.
const HALF_RANGE = 128;

// The four slots after the entry point, in ROM block order: each sprite's bank-1 Y byte (request
// bit + trigger line) and the bank-0 X byte it trades into.
const TAIL_SLOTS = [
  { request: SPRITE_BANK1_SLOT20_Y, partner: SPRITE_BANK0_SLOT20_X },
  { request: SPRITE_BANK1_SLOT21_Y, partner: SPRITE_BANK0_SLOT21_X },
  { request: SPRITE_BANK1_SLOT22_Y, partner: SPRITE_BANK0_SLOT22_X },
  { request: SPRITE_BANK1_SLOT23_Y, partner: SPRITE_BANK0_SLOT23_X },
];

export function spinRemainingSpriteMultiplexSlots(m, held = m.regs.a, firstSlotRequested = true) {
  const { mem8 } = m;
  // Sprite 19, finished from where the caller left off.
  if (firstSlotRequested) {
    // `ld c,a / ld a,(0xc000) / add a,c`: no carry means the raster has not reached the line yet.
    // The ROM's `jr nc,0x10f8` goes back to the block head, i.e. the full five-slot pass.
    if (((held + mem8[SCANLINE_COUNTER]) & 0x100) === 0) return loc_10f8(m);
    // Trade: store the held byte with its request bit cleared, and push X half the range over.
    mem8[SPRITE_BANK1_SLOT19_Y] = held & 0x7f;
    mem8[SPRITE_BANK0_SLOT19_X] = mem8[SPRITE_BANK0_SLOT19_X] + HALF_RANGE;
    if (m.beamPlan) m.beamPlan.push({ y: SPRITE_BANK1_SLOT19_Y, x: SPRITE_BANK0_SLOT19_X }); // beam-sync render
  }
  // Sprites 20-23: each block reads its own Y byte; bit 7 clear (value below 128) means no
  // request and the block is stepped over, else the request is cleared and the X byte gains 128.
  for (const slot of TAIL_SLOTS) {
    const request = mem8[slot.request];
    if (request < HALF_RANGE) continue;
    mem8[slot.request] = request - HALF_RANGE;
    mem8[slot.partner] = mem8[slot.partner] + HALF_RANGE;
    if (m.beamPlan) m.beamPlan.push({ y: slot.request, x: slot.partner }); // beam-sync render
  }
}

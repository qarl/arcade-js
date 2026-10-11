// SPDX-License-Identifier: GPL-3.0-only
/** flashPlayerWhiteOnAlternateCalls — one frame of an animation that flips a sprite entry's colour field between two
 * values as its own tick counter alternates, leaving the top two bits of that byte — the pair the
 * shape's mirroring lives in — exactly as they were. On the one tick where the counter reads the
 * threshold it also moves the step cell on and asks for a sound; every other tick only recolours.
 * The counter is stepped last and wraps at eight bits.
 *
 * ROM 0x1367-0x1392 (lift: translated/loc_1367.js). Grounding: [seen] (names.js ROUTINES 0x1367).
 *
 * ROLE IN THE MACHINE. The first part of the between-eras band animation that plays after a round
 * is won: stepRoundWonBandAnimation dispatches on ROUND_WON_ANIMATION_STEP 0xA9F0 [seen] and runs
 * this for its flash steps, running the player's ship white and back (mechanisms.md, round won).
 * The byte recoloured is PLAYER_SPRITE_ATTRIBUTE 0xAA40 [seen], the player's sprite colour + flip
 * byte, which the sprite publisher copies to the hardware. The colour flips once per call, and the
 * caller runs this on only two frames in every four (FRAME_TICK bit 1 clear). Under MAME, with this
 * routine run every frame in place of the heading dresser, the ship's pixels were seen alternating
 * white and blue frame by frame (names.js ROUTINES 0x1367, "why").
 * LIVE-OUT: memory. */

import { u8 } from "../../../core/int.js";
import { requestPlayerWhiteFlashSound } from "./requestPlayerWhiteFlashSound.js";
import { ROUND_WON_ANIMATION_STEP, PLAYER_FLASH_TICK, PLAYER_SPRITE_ATTRIBUTE } from "./names.js";


// The two flip (mirroring) bits kept from the attribute byte (`and 0xc0` at 0x1385).
const MIRROR_BITS = 0xc0;
// Bit 0 of the tick picks the colour (`and 0x01` at 0x1379).
const ALTERNATING_BIT = 0x01;
// 62 (0x3E) is a colour whose sprite pens are transparent and white -- the flash; 0 is the other
// half of the alternation (names.js ROUTINES 0x1367).
const FIRST_COLOUR = 62;
const SECOND_COLOUR = 0;

// On tick 8 the animation moves on to step 1 (`cp 0x08` / `ld a,0x01` at 0x136A-0x1370).
const SOUND_AT_TICK = 8;
const NEXT_STEP = 1;

export function flashPlayerWhiteOnAlternateCalls(m) {
  const { mem8 } = m;

  /* Step 1 -- the threshold tick (0x136A-0x1376). When PLAYER_FLASH_TICK 0xA9F1 [seen] reads 8,
   * hand the animation on to its next step by writing ROUND_WON_ANIMATION_STEP, and ask for the
   * round-won flash sound (requestPlayerWhiteFlashSound, which only sounds while a game is being
   * played). The recolour below still happens on this tick. */
  if (mem8[PLAYER_FLASH_TICK] === SOUND_AT_TICK) {
    mem8[ROUND_WON_ANIMATION_STEP] = NEXT_STEP;
    requestPlayerWhiteFlashSound(m);
  }

  /* Step 2 -- recolour (0x1379-0x138B). An even tick selects 62, an odd one 0, so the ship
   * changes colour on every call. Only the low six bits (the colour field) are replaced: the
   * top two bits are masked out and put back, so the ship keeps facing the way it was drawn. */
  const colour = (mem8[PLAYER_FLASH_TICK] & ALTERNATING_BIT) === 0 ? FIRST_COLOUR : SECOND_COLOUR;
  mem8[PLAYER_SPRITE_ATTRIBUTE] = (mem8[PLAYER_SPRITE_ATTRIBUTE] & MIRROR_BITS) + colour;

  /* Step 3 -- step the tick last (0x138E-0x1392); it wraps at eight bits. */
  mem8[PLAYER_FLASH_TICK] = u8(mem8[PLAYER_FLASH_TICK] + 1);
}

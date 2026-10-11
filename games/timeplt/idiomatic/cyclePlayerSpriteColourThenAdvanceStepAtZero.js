// SPDX-License-Identifier: GPL-3.0-only
/** cyclePlayerSpriteColourThenAdvanceStepAtZero — one frame of an animation that counts down and, while it does, drives a sprite
 * entry's colour field from a single bit of the count, so the colour holds for four frames at a
 * time; the top two bits of that byte, where the shape's mirroring lives, are left alone. The
 * frame on which the count is found already at zero also moves the step cell on, and the count
 * still steps that frame, wrapping below zero.
 *
 * ROM 0x1393-0x13CB (frozen lift translated/loc_1393.js). Grounding: [seen].
 *
 * Role in the machine: part of the between-eras band animation that plays after a round is won.
 * stepRoundStartIntroAnimation dispatches on INTRO_ANIMATION_STEP (0xA9F0), and its step 2 -- the
 * one call site -- runs this and then advanceScriptedCharPlaneBandTo4. The byte written,
 * PLAYER_SPRITE_ATTRIBUTE (0xAA40), is the shadow of the player ship's sprite attribute (colour +
 * flip bits), which publishSpriteShadow copies to the hardware.
 *
 * SPRITE_COLOUR_CYCLE_COUNTDOWN (0xA9F3) is seeded 4 (names.js), so bit 2 is set on the first
 * call only (colour 0x37) and clear afterwards (0x3F); when it is found at zero, the step moves on
 * to 3.
 *
 * LIVE-OUT: memory. */

import { u8 } from "../../../core/int.js";
import { INTRO_ANIMATION_STEP, PLAYER_SPRITE_ATTRIBUTE, SPRITE_COLOUR_CYCLE_COUNTDOWN } from "./names.js";


// Bits 6-7 of the attribute byte carry the sprite's mirroring and are kept (ROM `and 0xc0`).
const MIRROR_BITS = 0xc0;
// The one bit of the count that picks the colour (ROM `and 0x04`).
const ALTERNATING_BIT = 0x04;
// The two colour codes: 0x3F while that bit is clear (or the count is zero), 0x37 while it is set.
// (The ROM also has 0x36/0x3E arms, which no value of the masked bit reaches.)
const FIRST_COLOUR = 63;
const SECOND_COLOUR = 55;

// The step the animation hands off to when the count runs out (ROM `ld a,0x03 / ld (0xa9f0),a`).
const NEXT_STEP = 3;

export function cyclePlayerSpriteColourThenAdvanceStepAtZero(m) {
  const { mem8 } = m;
  const remaining = mem8[SPRITE_COLOUR_CYCLE_COUNTDOWN];

  // Count already exhausted: hand the animation on to step 3. The colour below is still written.
  if (remaining === 0) mem8[INTRO_ANIMATION_STEP] = NEXT_STEP;

  /* Pick the colour from bit 2 of the count and merge it under the kept mirroring bits (the ROM
   * adds rather than ORs, which is the same here because the colour codes never reach bit 6). */
  const colour = (remaining & ALTERNATING_BIT) === 0 ? FIRST_COLOUR : SECOND_COLOUR;
  mem8[PLAYER_SPRITE_ATTRIBUTE] = (mem8[PLAYER_SPRITE_ATTRIBUTE] & MIRROR_BITS) + colour;
  // Step the count every call, wrapping 0 -> 0xFF on the call that found it at zero.
  mem8[SPRITE_COLOUR_CYCLE_COUNTDOWN] = u8(remaining - 1);
}

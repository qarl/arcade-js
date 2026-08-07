// SPDX-License-Identifier: GPL-3.0-only
/** loc_1393 — one frame of an animation that counts down and, while it does, drives a sprite
 * entry's colour field from a single bit of the count, so the colour holds for four frames at a
 * time; the top two bits of that byte, where the shape's mirroring lives, are left alone. The
 * frame on which the count is found already at zero also moves the step cell on, and the count
 * still steps that frame, wrapping below zero. LIVE-OUT: memory. */

import { u8 } from "../../../core/int.js";

const ANIMATION_STEP = 0xa9f0;
const COUNTDOWN = 0xa9f3;
const SPRITE_ATTRIBUTE = 0xaa40;

const MIRROR_BITS = 0xc0;
const ALTERNATING_BIT = 0x04;
const FIRST_COLOUR = 63;
const SECOND_COLOUR = 55;

const NEXT_STEP = 3;

export function loc_1393(m) {
  const { mem8 } = m;
  const remaining = mem8[COUNTDOWN];

  if (remaining === 0) mem8[ANIMATION_STEP] = NEXT_STEP;

  const colour = (remaining & ALTERNATING_BIT) === 0 ? FIRST_COLOUR : SECOND_COLOUR;
  mem8[SPRITE_ATTRIBUTE] = (mem8[SPRITE_ATTRIBUTE] & MIRROR_BITS) + colour;
  mem8[COUNTDOWN] = u8(remaining - 1);
}

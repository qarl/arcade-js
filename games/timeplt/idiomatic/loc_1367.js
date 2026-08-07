// SPDX-License-Identifier: GPL-3.0-only
/** loc_1367 — one frame of an animation that flips a sprite entry's colour field between two
 * values as its own tick counter alternates, leaving the top two bits of that byte — the pair the
 * shape's mirroring lives in — exactly as they were. On the one tick where the counter reads the
 * threshold it also moves the step cell on and asks for a sound; every other tick only recolours.
 * The counter is stepped last and wraps at eight bits. LIVE-OUT: memory. */

import { u8 } from "../../../core/int.js";
import { loc_5811 } from "./loc_5811.js";

const ANIMATION_STEP = 0xa9f0;
const ANIMATION_TICK = 0xa9f1;
const SPRITE_ATTRIBUTE = 0xaa40;

const MIRROR_BITS = 0xc0;
const ALTERNATING_BIT = 0x01;
const FIRST_COLOUR = 62;
const SECOND_COLOUR = 0;

const SOUND_AT_TICK = 8;
const NEXT_STEP = 1;

export function loc_1367(m) {
  const { mem8 } = m;

  if (mem8[ANIMATION_TICK] === SOUND_AT_TICK) {
    mem8[ANIMATION_STEP] = NEXT_STEP;
    loc_5811(m);
  }

  const colour = (mem8[ANIMATION_TICK] & ALTERNATING_BIT) === 0 ? FIRST_COLOUR : SECOND_COLOUR;
  mem8[SPRITE_ATTRIBUTE] = (mem8[SPRITE_ATTRIBUTE] & MIRROR_BITS) + colour;
  mem8[ANIMATION_TICK] = u8(mem8[ANIMATION_TICK] + 1);
}

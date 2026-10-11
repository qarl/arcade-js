// SPDX-License-Identifier: GPL-3.0-only
/** dressSpriteFlutterShapesByFrameTickBit — give an object the two shapes of a two-pose flutter, picked by one bit of a counter
 * cell rather than by anything the object holds: one bit set selects one pair of shape codes,
 * clear selects the pair two higher. The two codes go into two slots of the same sprite entry, so a
 * single object is drawn from two shapes at once. Which pair is live changes only as fast as that
 * bit does; nothing here advances it.
 *
 * ROM 0x44DC-0x44F0 (frozen lift translated/loc_44dc.js). Grounding: [seen].
 *
 * Role in the machine: the last step of dressing a two-sprite object in the final era. Its callers
 * are dressSpriteForHeadingOrRetireAtEdge (which, in ERA_INDEX 4, writes the attribute bytes and
 * then hands the shapes to this -- mechanisms.md) and restartAnimationCounterThenDressFlutterSprite.
 * The counter cell is FRAME_TICK (0xA980), advanced once per vertical blank, so bit 2 flips every
 * four frames and the flutter holds each pose for four frames.
 *
 * Parameter: `sprite` is the object's sprite entry (ROM IY).
 *
 * LIVE-OUT: memory, two bytes. */

import { u16 } from "../../../core/int.js";
import { FRAME_TICK } from "./names.js";

// FRAME_TICK bit 2 (ROM `bit 2,a`).
const ALTERNATION_BIT = 0x04;
// The pair used while that bit is SET: ROM `ld hl,0xd4d5` -- L = 0xD5 for slot +1, H = 0xD4 for +3.
const FIRST_SHAPE = 0xd5;
const SECOND_SHAPE = 0xd4;
// While the bit is CLEAR the ROM adds DE = 0x0202, moving both codes up two (0xD7/0xD6).
const SHAPE_STEP = 2;
// The two shape slots of the sprite entry (`ld (iy+0x01),l` and `ld (iy+0x03),h`).
const FIRST_SLOT = 1;
const SECOND_SLOT = 3;

export function dressSpriteFlutterShapesByFrameTickBit(m, sprite = m.regs.iy) {
  const { mem8 } = m;
  // Bit set keeps the base pair (`jr nz` skips the add); bit clear takes the other frame.
  const flutter = (mem8[FRAME_TICK] & ALTERNATION_BIT) === 0 ? SHAPE_STEP : 0;
  mem8[u16(sprite + FIRST_SLOT)] = FIRST_SHAPE + flutter;
  mem8[u16(sprite + SECOND_SLOT)] = SECOND_SHAPE + flutter;
}

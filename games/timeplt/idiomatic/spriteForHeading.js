// SPDX-License-Identifier: GPL-3.0-only
/** spriteForHeading — pick the sprite shape, and the byte beside it, that show an object pointing the
 * way it is heading. The heading is a point on a 256-step circle; rounded to the nearest of
 * sixteen equal sectors it indexes two parallel sixteen-entry tables, the first holding the
 * shape and the second the byte that mirrors it — eight shapes cover the circle because the rest
 * reuse them mirrored, and the tint those bytes carry is the same in every entry. Every other
 * pair of frames the shape moves on by eight, so each direction alternates between two.
 *
 * ROM 0x2A57-0x2A76 (frozen lift translated/loc_2a57.js). Grounding: [seen].
 *
 * Role in the machine: a dresser shared by two object classes (so it is not the player's own —
 * the player has a finer, 32-sector dresser that stores rather than returns). Its callers store
 * the two bytes it returns into an object's sprite entry: the shape into the entry's +0x01 tile
 * code and the mirror byte into its +0x30 attribute (the entry's +0x00 and +0x31 are the two
 * screen coordinates, written elsewhere by the movers).
 *
 * `object` is the object's sixteen-byte record (the Z80 held it in IX); its byte +2 is the heading
 * the object is currently flying on.
 *
 * LIVE-OUT: the pair, left standing for the caller to store into the object's sprite entry; nothing
 * is written. The Z80 returned it in B (shape) and C (mirror byte), which is why both are also
 * left in those registers. */

import { u8, u16 } from "../../../core/int.js";
import { FRAME_TICK, SPRITE_SHAPE_BY_SECTOR_TABLE, SPRITE_MIRROR_BY_SECTOR_TABLE } from "./names.js";

// Record byte +2: the object's current heading (0-255 for one whole turn).
const HEADING = 2;
// The ROM rounds the heading to one of sixteen compass sectors (`and 0x0f` at 0x2A63), each
// sixteen heading steps wide.
const SECTORS = 16;
const STEPS_PER_SECTOR = 256 / SECTORS;
// Bit 1 of the frame counter (`bit 1,a` at 0x2A6F): it flips every second frame, so the
// alternate shape shows for two frames, then the base shape for two.
const ALTERNATE_POSE_BIT = 2;
// The alternate shape bank sits eight codes past the base one (`add a,0x08` at 0x2A73).
const ALTERNATE_POSE_SHAPE_STEP = 8;

export function spriteForHeading(m, object = m.regs.ix) {
  const { regs, mem8 } = m;
  // Round the heading to the NEAREST sector rather than truncating it: adding half a sector
  // (the ROM's `add a,0x08`, wrapping at eight bits) before dividing by sixteen (its four
  // `rrca`s plus the mask) centres each sector on its compass direction, so heading 0 and
  // heading 255 both land in sector 0.
  const heading = mem8[u16(object + HEADING)];
  const sector = Math.floor(u8(heading + STEPS_PER_SECTOR / 2) / STEPS_PER_SECTOR);
  // Which half of the two-frame flicker this is: FRAME_TICK advances once per vblank, so its
  // bit 1 alternates the shape bank every two frames — the object's animation.
  const alternatePose = (mem8[FRAME_TICK] & ALTERNATE_POSE_BIT) !== 0;
  // The two ROM tables are parallel, sixteen bytes apart (0x2A77 then 0x2A87): the first gives
  // the shape for the sector, the second the attribute byte whose flip bits mirror that shape
  // so a handful of drawn shapes cover all sixteen directions.
  const shape = mem8[SPRITE_SHAPE_BY_SECTOR_TABLE + sector] + (alternatePose ? ALTERNATE_POSE_SHAPE_STEP : 0);
  const mirror = mem8[SPRITE_MIRROR_BY_SECTOR_TABLE + sector];
  // Hand the pair back (and leave it in B and C, where the ROM's callers read it).
  return [regs.b = shape, regs.c = mirror];
}

// SPDX-License-Identifier: GPL-3.0-only
/** driftAtHalfWorldScroll — drift one object by half of a displacement that is not its own.
 * Each of the object's two coordinates is 16 bits stored split: the whole part off one base,
 * the fraction off the other. Both gain the shared world displacement rather than anything read
 * off the object, halved on the way in, so this keeps half the pace of one that takes the whole
 * of it. The fraction carries into the whole, so a coordinate moves and wraps as one number.
 * LIVE-OUT: memory, four bytes; the second moved coordinate is also left standing.
 *
 * ROM 0x2DF4-0x2E18 (frozen lift loc_2df4). Grounding: [seen] (names.js ROUTINES 0x2DF4).
 *
 * Role in the machine: Time Pilot's ship never moves on the glass. Each frame its velocity is
 * turned into a displacement, negated, and stored in WORLD_SCROLL_Y (0xA808) [seen] and
 * WORLD_SCROLL_X (0xA80A) [seen]; everything else on screen is moved by that displacement so the
 * world appears to fly past. Scenery gets parallax from three sibling routines, each moving an
 * object by a different fraction of the displacement — this one (half),
 * driftAtThreeQuartersWorldScroll (three quarters) and driftAtFiveQuartersWorldScroll (five
 * quarters). This is the slowest rung: an object on it lags the world furthest. Its callers are the
 * scenery wrappers dispatched by the era-keyed scenery dispatcher, every dispatch seated inside the
 * scenery slots (names.js; mechanisms.md, the scroll and scenery section).
 *
 * Parameters: `object` is the object record (IX in the ROM), holding the fractional byte of each
 * coordinate; `sprite` is its sprite entry (IY in the ROM), holding the whole byte of each
 * coordinate — the bytes the video hardware reads as the sprite's position.
 *
 * "Left standing": displaceByHalf also leaves its result in HL, so after the second coordinate
 * HL still holds that coordinate's moved 16-bit value, as it does after the ROM's own last call.
 */

import { displaceByHalf } from "./displaceByHalf.js";
import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "./names.js";
import { coordinateAt, storeCoordinate } from "./objectGeometry.js";

// Byte offsets, from the ROM's indexed loads and stores.
const ROW_REMAINDER = 3; // ld e,(ix+0x03): fraction of the coordinate paired with WORLD_SCROLL_Y
const COLUMN_REMAINDER = 5; // ld e,(ix+0x05): fraction of the coordinate paired with WORLD_SCROLL_X
const SPRITE_ROW = 49; // ld d,(iy+0x31): the sprite entry's native-Y (whole) byte

export function driftAtHalfWorldScroll(m, object = m.regs.ix, sprite = m.regs.iy) {
  /* First coordinate: whole at sprite +0x31, fraction at record +3, moved by the WORLD_SCROLL_Y
   * component (ROM 0x2DF4-0x2E06: ld d,(iy+0x31) / ld e,(ix+0x03) / ld hl,(0xa808) / call 0x304d). */
  driftCoordinate(m, sprite + SPRITE_ROW, object + ROW_REMAINDER, m.mem16[WORLD_SCROLL_Y]);
  /* Second coordinate: whole at sprite +0 (native X), fraction at record +5, moved by the
   * WORLD_SCROLL_X component (ROM 0x2E06-0x2E18, same shape with 0xA80A). The board is rotated
   * (ROT90), so native X and Y are swapped relative to the glass — see names.js. */
  driftCoordinate(m, sprite, object + COLUMN_REMAINDER, m.mem16[WORLD_SCROLL_X]);
}

/** One coordinate: whole and fraction read as a single number, moved, then split back.
 * The ROM builds the number in DE (whole byte in D, fraction in E) and calls displaceByHalf
 * (0x304D), which adds the displacement less half of it — the half taken by a signed shift that
 * rounds toward the negative — and returns the 16-bit sum in HL. */
function driftCoordinate(m, wholeAddr, fractionAddr, displacement) {
  const moved = displaceByHalf(m, displacement, coordinateAt(m, wholeAddr, fractionAddr));
  // Split back: high byte to the sprite entry (ld (iy+..),h), low byte to the record (ld (ix+..),l).
  storeCoordinate(m, wholeAddr, fractionAddr, moved);
}

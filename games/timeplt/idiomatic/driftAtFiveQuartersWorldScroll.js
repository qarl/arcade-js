// SPDX-License-Identifier: GPL-3.0-only
/** driftAtFiveQuartersWorldScroll — carry one object along with the scrolling world, over-travelling it by a quarter.
 * Each of the object's two coordinates is 16 bits stored split: the whole part off one base, the
 * fraction off the other. Both gain a displacement read from a fixed pair of cells rather than
 * from the object — so every object running this drifts alike — lengthened by a quarter of
 * itself before it lands, which carries the object further than those cells hold.
 * LIVE-OUT: memory only — four bytes; nothing is clamped and nothing is returned.
 *
 * ROM 0x2D6E-0x2D92 (frozen lift loc_2d6e). Grounding: [seen] (names.js ROUTINES 0x2D6E).
 *
 * Role in the machine: Time Pilot's ship never moves on the glass. Each frame its velocity is
 * turned into a displacement, negated, and stored in WORLD_SCROLL_Y (0xA808) [seen] and
 * WORLD_SCROLL_X (0xA80A) [seen]; everything else on screen is moved by that displacement so the
 * world appears to fly past. Scenery gets parallax from three sibling routines, each moving an
 * object by a different fraction of the displacement — driftAtHalfWorldScroll (half),
 * driftAtThreeQuartersWorldScroll (three quarters) and this one (five quarters). An object moved by
 * more than the whole displacement LEADS the world rather than lagging it. Its callers are the
 * scenery wrappers dispatched by the era-keyed scenery dispatcher, every dispatch seated inside the
 * scenery slots (names.js; mechanisms.md, the scroll and scenery section).
 *
 * Parameters: `object` is the object record (IX in the ROM), holding the fractional byte of each
 * coordinate; `sprite` is its sprite entry (IY in the ROM), holding the whole byte of each
 * coordinate — the bytes the video hardware reads as the sprite's position.
 */

import { displaceByFiveQuarters } from "./displaceByFiveQuarters.js";
import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "./names.js";
import { coordinateAt, storeCoordinate } from "./objectGeometry.js";

export function driftAtFiveQuartersWorldScroll(m, object = m.regs.ix, sprite = m.regs.iy) {
  /* First coordinate: the sprite entry's native-Y byte at +0x31 (49) is the whole part and the
   * object record's +3 its fraction; it takes the WORLD_SCROLL_Y component
   * (ROM 0x2D6E-0x2D80: ld d,(iy+0x31) / ld e,(ix+0x03) / ld hl,(0xa808) / call 0x2e31). */
  driftCoordinate(m, sprite + 49, object + 3, m.mem16[WORLD_SCROLL_Y]);
  /* Second coordinate: the sprite entry's native-X byte at +0 is the whole part and the object
   * record's +5 its fraction; it takes the WORLD_SCROLL_X component (ROM 0x2D80-0x2D92, the same
   * shape with 0xA80A). The board is rotated (ROT90), so native X and Y are swapped relative to
   * the glass — see the WORLD_SCROLL_X / WORLD_SCROLL_Y entries in names.js. */
  driftCoordinate(m, sprite, object + 5, m.mem16[WORLD_SCROLL_X]);
}

/** One coordinate: whole and fraction read as a single number, displaced, then split back.
 * The ROM builds the number in DE (whole byte in D, fraction in E), calls displaceByFiveQuarters
 * (0x2E31), which adds the displacement plus a quarter of it (the quarter a signed shift that
 * rounds down) and hands the sum back in HL, then stores H back as the whole and L as the
 * fraction. The sum wraps at sixteen bits, and the fraction carries into the whole, so the
 * coordinate moves and wraps as one number. */
function driftCoordinate(m, wholeAddr, fractionAddr, displacement) {
  const moved = displaceByFiveQuarters(m, displacement, coordinateAt(m, wholeAddr, fractionAddr));
  // Split back: high byte to the sprite entry (ld (iy+..),h), low byte to the record (ld (ix+..),l).
  storeCoordinate(m, wholeAddr, fractionAddr, moved);
}

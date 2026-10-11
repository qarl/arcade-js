// SPDX-License-Identifier: GPL-3.0-only
/** driftWithWorldScroll — carry one object along with the scrolling world.
 * Each of the object's two coordinates is 16 bits stored split: the whole part off one base,
 * the fraction off the other. Both gain a displacement read from a fixed pair of cells rather
 * than from the object, so every object that runs this drifts by the same amount per frame.
 *
 * ROM 0x2B60-0x2B82 (frozen lift translated/loc_2b60.js). Grounding: [seen].
 *
 * Role in the machine: this is how the camera works. The player's plane stays fixed on the glass
 * and the world moves opposite it: negateVelocityIntoWorldScrollThenDressSprite writes WORLD_SCROLL_Y
 * (0xA808) and WORLD_SCROLL_X (0xA80A) each frame as the NEGATION of the player's velocity, and
 * adding that pair to a world-static object streams it past the ship (names.js "why"; gameplay.md).
 * The object handlers that call it include loc_43f0, runParachutistSlot and
 * runOneShotAnimatedObjectSlot. The half, three-quarter and five-quarter wrappers do the same with a
 * fraction of the scroll, for parallax.
 *
 * The X/Y in the cell names are the board's NATIVE raster axes: under ROT90, native Y is the
 * display's horizontal axis and native X its vertical one (names.js).
 *
 * Parameters: `object` is the object's record (ROM IX), `sprite` its sprite entry (ROM IY).
 *
 * LIVE-OUT: memory only — four bytes; nothing is clamped and nothing is returned. */

import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "./names.js";
import { addToCoordinate } from "./objectGeometry.js";

export function driftWithWorldScroll(m, object = m.regs.ix, sprite = m.regs.iy) {
  /* Native Y: whole part in the sprite entry at +0x31 (49), fraction in the object record at +3,
   * displaced by WORLD_SCROLL_Y (ROM `ld h,(iy+0x31) / ld l,(ix+0x03) / ld de,(0xa808) / add hl,de`). */
  addToCoordinate(m, sprite + 49, object + 3, m.mem16[WORLD_SCROLL_Y]);
  /* Native X: whole part in the sprite entry at +0x00, fraction in the object record at +5,
   * displaced by WORLD_SCROLL_X (`ld de,(0xa80a)`). The sprite entry holds the whole part directly,
   * so the drift moves the drawn sprite with no further step. */
  addToCoordinate(m, sprite, object + 5, m.mem16[WORLD_SCROLL_X]);
}

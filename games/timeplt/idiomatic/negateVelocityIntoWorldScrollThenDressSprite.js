// SPDX-License-Identifier: GPL-3.0-only
/** negateVelocityIntoWorldScrollThenDressSprite — point the world the opposite way to the ship. Two velocity components arrive, each is
 * negated as a sixteen-bit quantity and stored as this pass's world scroll on its own axis, so the
 * scenery slides against the motion; the ship's sprite is then dressed for the way it is heading.
 * Neither component is read back here. LIVE-OUT: memory-only.
 *
 * ROM 0x1F55-0x1F67 (frozen lift translated/loc_1f55.js). Grounding: [seen] (names.js ROUTINES 0x1f55).
 *
 * ROLE IN THE MACHINE. In Time Pilot the player's ship stays fixed at the centre of the screen and
 * the world moves past it. The ship has no position of its own: once a pass
 * scrollWorldAtTheEraPace looks up the velocity pair its heading calls for (at the era's pace) and
 * hands it here, and apart from bulk RAM clears this routine is one of only two writers of the scroll
 * cells (the other, resetPlayfieldAndArmNewRound, zeroes them — mechanisms.md). World-fixed objects then add
 * WORLD_SCROLL_Y / WORLD_SCROLL_X (or a fraction of them, for parallax) to their own coordinates
 * through driftWithWorldScroll and its wrappers, so storing the NEGATED velocity there is what
 * makes the world drift opposite to the ship's travel — the camera.
 *
 * Both cells are 8.8 fixed point in NATIVE raster axes (names.js): WORLD_SCROLL_Y (0xA808) lands in
 * a sprite entry's +0x31 byte, WORLD_SCROLL_X (0xA80A) in its +0x00 byte. The board is ROT90, so
 * native Y is the display's horizontal and native X its vertical; the names are field names, not
 * screen directions.
 *
 * `alongY` carries the ROM's DE (the component bound for WORLD_SCROLL_Y) and `alongX` its BC.
 */

import { u16 } from "../../../core/int.js";
import { dressPlayerSpriteForHeading } from "./dressPlayerSpriteForHeading.js";
import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "./names.js";

export function negateVelocityIntoWorldScrollThenDressSprite(m, alongY = m.regs.de, alongX = m.regs.bc) {
  const { mem16 } = m;
  /* Negate each component as a 16-bit two's-complement word. The ROM does it as
   * `xor a / ld h,a / ld l,a / sbc hl,de` (0 - DE, carry cleared by the xor) and stores the word
   * with `ld (0xa808),hl`; then the same four instructions with BC into `ld (0xa80a),hl`. */
  mem16[WORLD_SCROLL_Y] = u16(-alongY);
  mem16[WORLD_SCROLL_X] = u16(-alongX);
  /* `jp 0x20af` — tail into dressPlayerSpriteForHeading, which rounds the ship's heading to one of
   * thirty-two sectors and writes the matching shape into the player's own sprite entry. Its `ret`
   * returns to our caller. */
  dressPlayerSpriteForHeading(m);
}

// SPDX-License-Identifier: GPL-3.0-only
/** dressPlayerSpriteForHeading — refresh one fixed sprite entry's shape and the byte beside it from the direction
 * cell. The direction is a point on a 256-step circle; rounded to the nearest of thirty-two equal
 * sectors it indexes two parallel thirty-two-entry tables in the program image, the first holding
 * the shape and the second the byte that goes with it. LIVE-OUT: memory-only.
 *
 * ROM 0x20AF-0x20CD (frozen lift translated/loc_20af.js). Grounding: [seen] (names.js ROUTINES).
 *
 * ROLE IN THE MACHINE. The player's ship never moves on the screen -- the world scrolls past it --
 * so the only thing that shows which way it faces is its SHAPE. This entry keeps the player's
 * sprite entry (PLAYER_SPRITE_CODE 0xAA11, entry +1, and PLAYER_SPRITE_ATTRIBUTE 0xAA40, its colour/flip
 * byte at entry +0x30) in step with PLAYER_HEADING (0xA802, byte +2 of the player's record).
 * resetPlayfieldForLifeStart calls it when a life starts, and
 * negateVelocityIntoWorldScrollThenDressSprite calls it after turning the player's velocity into
 * the world scroll. Under MAME the entry matched the two tables on every sampled frame while the
 * ship was alive (names.js).
 */

import { offsetAddress } from "./offsetAddress.js";
import { u8 } from "../../../core/int.js";
import { PLAYER_HEADING, PLAYER_SPRITE_ATTRIBUTE, PLAYER_SPRITE_CODE, PLAYER_HEADING_SHAPE_TABLE } from "./names.js";

const SECTORS = 32;
const STEPS_PER_SECTOR = 256 / SECTORS;
const SECOND_TABLE = SECTORS;

export function dressPlayerSpriteForHeading(m) {
  const { mem8 } = m;
  // Round the heading to the NEAREST of 32 sectors: add half a sector (ROM `add a,0x04`), then take
  // the top five bits (`rrca` x3, `and 0x1f`). The add wraps at 256, so headings just below a full
  // turn round up into sector 0 and the circle closes.
  const sector = Math.floor(u8(mem8[PLAYER_HEADING] + STEPS_PER_SECTOR / 2) / STEPS_PER_SECTOR);
  // PLAYER_HEADING_SHAPE_TABLE (0x20CE, the bytes immediately after this routine) indexed by
  // sector gives the shape (ROM `rst 0x18` = offsetAddress); the parallel table 32 bytes on
  // (`add hl,de` with DE = 0x20) gives the attribute byte. Both go straight into the fixed entry.
  const entry = offsetAddress(m, PLAYER_HEADING_SHAPE_TABLE, sector);
  mem8[PLAYER_SPRITE_CODE] = mem8[entry];
  mem8[PLAYER_SPRITE_ATTRIBUTE] = mem8[entry + SECOND_TABLE];
}

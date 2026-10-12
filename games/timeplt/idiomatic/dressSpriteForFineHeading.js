// SPDX-License-Identifier: GPL-3.0-only
/** dressSpriteForFineHeading — point an object's sprite entry the way the object is heading. The heading is a
 * point on a 256-step circle; rounded to the nearest of thirty-two equal sectors it selects a
 * two-byte entry of a table, whose first byte is the shape and whose second is the byte laid
 * beside it. Every other pair of frames the shape moves on by eight, so each sector alternates
 * between two shapes while the byte beside it does not change. Both go straight into the sprite
 * entry the caller's cursor names — this reads the object and writes the entry, and decides
 * nothing about either. LIVE-OUT: memory.
 *
 * ROM 0x2A97-0x2ABB (frozen lift translated/loc_2a97.js). Grounding: [seen] (names.js ROUTINES).
 *
 * ROLE IN THE MACHINE. serviceEra2EnemyCraftSlot, the craft handler of the third era, calls this
 * for each craft; under MAME it ran only on the tape that reaches that era (names.js). The entry's
 * shape byte is at +1 and its attribute byte (colour and flip) at +0x30, in the second of
 * the two parallel sprite runs (mechanisms.md). The table's second byte is a FLIP attribute, not a
 * per-sector palette: under MAME the writes took only 0x5C and 0xDC, one bit apart. The alternating
 * shape bank is driven by FRAME_TICK (0xA980), which advances by one every frame.
 *
 * Parameters: `entry` is the sprite entry (the ROM's IY) and `object` the object's record (IX).
 */

import { u8, u16 } from "../../../core/int.js";
import { offsetAddress } from "./offsetAddress.js";
import { FRAME_TICK, FINE_HEADING_SHAPE_TABLE } from "./names.js";

const HEADING = 2;
const SECTORS = 32;
const STEPS_PER_SECTOR = 256 / SECTORS;
const ENTRY_WIDTH = 2;
const ALTERNATE_POSE_BIT = 2;
const ALTERNATE_POSE_SHAPE_STEP = 8;
const SHAPE_IN_ENTRY = 1;
const BESIDE_IT_IN_ENTRY = 48;

export function dressSpriteForFineHeading(m, entry = m.regs.iy, object = m.regs.ix) {
  const { mem8 } = m;
  // Nearest of 32 sectors: heading + 4, wrapping at 256 (ROM `add a,0x04`), keep the top five bits
  // and scale to a two-byte entry offset (`and 0xf8 / rrca / rrca / and 0x3f`).
  const heading = mem8[u16(object + HEADING)];
  const sector = Math.floor(u8(heading + STEPS_PER_SECTOR / 2) / STEPS_PER_SECTOR);

  const selected = offsetAddress(m, FINE_HEADING_SHAPE_TABLE, sector * ENTRY_WIDTH);

  // Shape: the entry's first byte, plus 8 on frames with FRAME_TICK bit 1 set (ROM `and 0x02 / jr nz`
  // to `ld a,0x08`, then `add a,b`), so it holds one shape for two frames and the other for two.
  // It goes into sprite entry +1 (`ld (iy+0x01),a`); the entry's second byte goes into +0x30.
  const alternatePose = (mem8[FRAME_TICK] & ALTERNATE_POSE_BIT) !== 0;
  mem8[entry + SHAPE_IN_ENTRY] = mem8[selected] + (alternatePose ? ALTERNATE_POSE_SHAPE_STEP : 0);
  mem8[entry + BESIDE_IT_IN_ENTRY] = mem8[u16(selected + 1)];
}

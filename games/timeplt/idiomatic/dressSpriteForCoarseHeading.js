// SPDX-License-Identifier: GPL-3.0-only
/** dressSpriteForCoarseHeading — show an object pointing the way it is heading: its heading byte is rounded to one of
 * sixteen sectors, and that sector picks a shape and its attribute byte out of two parallel tables
 * in the program image, sixteen entries apart. Both go into the object's sprite entry, the
 * shape in one slot and the attribute byte in a slot further on. Rounding adds half a sector before
 * taking the top nibble, so a heading is snapped to the NEAREST sector rather than truncated, and
 * that addition wraps, which is what closes the circle of sectors. LIVE-OUT: memory, two bytes.
 *
 * ROM 0x2AFC-0x2B17 (frozen lift translated/loc_2afc.js). Grounding: [seen] (names.js ROUTINES).
 *
 * ROLE IN THE MACHINE. Each enemy object has a record (heading at +2) and a sprite entry whose
 * shape byte is at +1 and whose attribute byte (colour and flip) is 0x30 further on, in the
 * second of the two parallel sprite runs (mechanisms.md). serviceEra3EnemyCraftSlot calls this for
 * its craft; dressSpriteForFineHeading is the thirty-two-sector sibling another era's craft use.
 *
 * Parameters: `object` is the object's record (the ROM's IX) and `sprite` its sprite entry (IY).
 */

import { u8, u16 } from "../../../core/int.js";
import { offsetAddress } from "./offsetAddress.js";
import { COARSE_HEADING_SHAPE_TABLE } from "./names.js";

const HEADING_IN_RECORD = 2;
const SECOND_TABLE_GAP = 16;
const SHAPE_IN_ENTRY = 1;
const SECOND_BYTE_IN_ENTRY = 48;
const HALF_SECTOR = 8;

export function dressSpriteForCoarseHeading(m, object = m.regs.ix, sprite = m.regs.iy) {
  const { mem8 } = m;
  // Nearest of 16 sectors: heading + 8, wrapping at 256 (ROM `ld a,(ix+0x02) / add a,0x08`), then
  // the top nibble (`rrca` x4, `and 0x0f`).
  const sector = u8(mem8[u16(object + HEADING_IN_RECORD)] + HALF_SECTOR) >> 4;

  // Index COARSE_HEADING_SHAPE_TABLE (0x2B18, just after this routine) by the sector (ROM `rst
  // 0x18` = offsetAddress).
  const shapeEntry = offsetAddress(m, COARSE_HEADING_SHAPE_TABLE, sector);

  // Shape into entry +1 (ROM `ld (iy+0x01),a`); the byte sixteen on, in the parallel table
  // (`add hl,de` with DE = 0x10), into entry +0x30 (`ld (iy+0x30),a`).
  mem8[u16(sprite + SHAPE_IN_ENTRY)] = mem8[shapeEntry];
  mem8[u16(sprite + SECOND_BYTE_IN_ENTRY)] = mem8[u16(shapeEntry + SECOND_TABLE_GAP)];
}

// SPDX-License-Identifier: GPL-3.0-only
/** headingToward — the heading that points from one object at a point, as one byte of a
 * 256-step
 * circle. Each of the two axes gives a distance and a sense; the senses, plus which of the two
 * distances is the shorter, name one of eight sectors, and the shorter distance over the longer
 * places the answer within that sector at one of thirty-two rungs. A sector whose byte carries the
 * marker bit counts its rungs backwards, which is what makes the answer sweep the same way all the
 * way round. Two equal distances skip all of that and read a fixed heading straight out of a
 * second, shorter table. Nothing is written.
 *
 * ROM 0x33B8-0x3414 (frozen lift translated/loc_33b8.js). Grounding: [seen] (names.js ROUTINES 0x33b8).
 *
 * Role in the machine: the aiming primitive. Its answer is used as an angle by its readers —
 * names.js records fireCraftShotWhenAimedNearPlayer testing it against the object's own heading
 * in a wrapped window, and reaimEnemyCraftByFlightScriptOnPhaseTick adding half a turn before storing
 * it for steerTowardAimHeading to turn toward. The octant table (OCTANT_BASE_HEADING_TABLE, ROM
 * 0x3415) holds the eight multiples of 32, so the eight sectors tile the circle exactly.
 *
 * `point` addresses the target's pair of coordinate bytes (HL on the Z80): the byte at `point`
 * pairs with the object's +0x00 coordinate, the byte just below it with the object's +0x31.
 * `object` is the object's sprite entry (IY).
 *
 * LIVE-OUT: the heading, returned and in the accumulator. */

import { u8, u16 } from "../../../core/int.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { offsetAddress } from "./offsetAddress.js";
import { DIAGONAL_HEADING_TABLE, OCTANT_BASE_HEADING_TABLE } from "./names.js";

// The object's two coordinates in its sprite entry.
const FIRST_COORDINATE = 0x00;
const SECOND_COORDINATE = 0x31;

// The sector index is built as three bits, as the ROM builds it in C: bit 0 when the second
// distance is negative, bit 1 when the first is, bit 2 when the first distance is the shorter.
const SECOND_IS_BELOW = 0x01;
const FIRST_IS_BELOW = 0x02;
const FIRST_IS_SHORTER = 0x04;

// Thirty-two rungs per eighth of a turn; bit 5 of an octant base marks a backwards-counting sector.
const RUNGS_PER_SECTOR = 32;
const COUNTS_BACKWARDS = 0x20;

export function headingToward(m, point = m.regs.hl, object = m.regs.iy) {
  const { regs, mem8 } = m;

  // Signed distance from the object to the point on each axis. The second target byte sits one
  // below `point` inside the same 256-byte page — the ROM steps only the low byte (`dec l`).
  const firstReach = mem8[point] - mem8[u16(object + FIRST_COORDINATE)];
  const secondReach =
    mem8[(point & (0xff << 8)) | u8(point - 1)] - mem8[u16(object + SECOND_COORDINATE)];

  // Record each sense in the sector bits and keep the magnitudes (the ROM's `neg` on a borrow).
  let sector = (secondReach < 0 ? SECOND_IS_BELOW : 0) | (firstReach < 0 ? FIRST_IS_BELOW : 0);
  const firstLeg = Math.abs(firstReach);
  const secondLeg = Math.abs(secondReach);

  // Exactly diagonal: the two sense bits index DIAGONAL_HEADING_TABLE (ROM 0x341D), which holds
  // the four diagonal headings.
  if (firstLeg === secondLeg) {
    return fetchTableByte(m, DIAGONAL_HEADING_TABLE, sector);
  }
  // Otherwise the third sector bit says which leg is the shorter.
  if (firstLeg < secondLeg) sector |= FIRST_IS_SHORTER;

  // Place the answer inside the sector: shorter over longer, scaled to 0..31. The ROM does this
  // with an eight-step shift-and-subtract divide and keeps five bits of the quotient.
  const shorter = Math.min(firstLeg, secondLeg);
  const longer = Math.max(firstLeg, secondLeg);
  let rung = Math.floor((shorter * RUNGS_PER_SECTOR) / longer);

  // The sector's base heading; a sector marked backwards counts its rungs down from the far end
  // (the ROM's `ld a,0x1f; sub b`), so every sector sweeps the circle the same way.
  const heading = mem8[offsetAddress(m, OCTANT_BASE_HEADING_TABLE, sector)];
  if (heading & COUNTS_BACKWARDS) rung = RUNGS_PER_SECTOR - 1 - rung;

  // Base plus rung, eight-bit, is the heading (the ROM's `add a,(hl)`).
  return (regs.a = u8(heading + rung));
}

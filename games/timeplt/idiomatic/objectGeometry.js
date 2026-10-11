// SPDX-License-Identifier: GPL-3.0-only
/** objectGeometry — the coordinate and record arithmetic the object movers and collision tests share.
 *
 * ROM: none. These are not transcribed ROM routines and have no names.js entry or grounding tag; each
 * is an idiom the ROM writes out inline at many sites, gathered here so every site reads it the same
 * way.
 *
 * A sprite coordinate is an 8.8 fixed-point number split across two tables: the whole part sits in
 * the object's sprite entry and the fraction in its record (mechanisms.md, sprite entry layout). The
 * ROM glues the two bytes into a register pair, adds a displacement with `add hl,de`, and stores the
 * halves back, so the sum wraps at sixteen bits.
 *
 * A collision box is a wrapped window: the ROM takes the 8-bit difference of two coordinates, biases
 * it by the box's reach and compares the result unsigned against the box's span (`sub / add a,l /
 * cp h`), which accepts a difference from -reach to span - reach - 1.
 *
 * Object records are sixteen bytes apart, and the sweeps step a record cursor by adding to its low
 * byte only, so the cursor never leaves its page.
 *
 * LIVE-OUT: storeCoordinate and addToCoordinate write the two coordinate bytes; the rest only compute.
 */

import { u8 } from "../../../core/int.js";

// One object record is sixteen bytes.
const RECORD_STRIDE = 16;

/** Two coordinates are close enough when their wrapped difference lands inside the box. */
export const within = (mine, theirs, reach, span) => u8(u8(mine - theirs) + reach) < span;

/** Advance a record cursor one record on WITHOUT leaving its page: the carry out of the low byte is dropped. */
export const nextRecordInPage = (cursor) => (cursor - (cursor & 0xff)) | u8(cursor + RECORD_STRIDE);

/** The 8.8 coordinate glued from its whole byte and its fraction byte. */
export function coordinateAt(m, wholeAddr, fractionAddr) {
  return (m.mem8[wholeAddr] << 8) + m.mem8[fractionAddr];
}

/** Split a coordinate back into its two bytes; each byte store keeps its own eight bits, so it wraps at sixteen. */
export function storeCoordinate(m, wholeAddr, fractionAddr, value) {
  m.mem8[wholeAddr] = value >> 8;
  m.mem8[fractionAddr] = value;
}

/** Add a displacement to an 8.8 coordinate in place (the ROM's glue / `add hl,de` / split). */
export function addToCoordinate(m, wholeAddr, fractionAddr, displacement) {
  storeCoordinate(m, wholeAddr, fractionAddr, coordinateAt(m, wholeAddr, fractionAddr) + displacement);
}

// SPDX-License-Identifier: GPL-3.0-only
/** velocityForHeadingAtSlowestSpeed — hand back the perpendicular component pair an object's
 * heading calls for, at the slowest pace in the velocity-table ladder. Choosing that table is all
 * this entry does; an incoming pointer is discarded. LIVE-OUT: the pair.
 *
 * ROM 0x5942-0x5947 (frozen lift translated/loc_5942.js): `ld hl,0x59d7 / jp 0x596e`, a two-
 * instruction shim into velocityForHeading. Grounding: [seen] (names.js ROUTINES 0x5942).
 *
 * WHY "SLOWEST": the shims in front of velocityForHeading fix the same six tables, in the same order,
 * as the flyAlongHeading shims, so they carry the same rank names -- this is the mirror of
 * flyAtSlowestSpeed (0x5840). The table at 0x59D7 (SLOWEST_VELOCITY_TABLE) peaks at 206, the bottom
 * of the six-rung ROM ladder 206/231/256/281/306/331, so it is slowest however the ladder is counted
 * (the 231 and 281 shims at 0x5948 and 0x595F are never entered). It is a rank over tables, not over
 * delivered speed: loc_598e reads this same table through the doubling body and hands back up to 412
 * (names.js "why" for 0x5942).
 *
 * Role in the machine: names.js records two readers: armBomberSlotWhenTimerFires stores the pair
 * straight into the slot it arms, and it is the era-0 word of the arm table at 0x46C4 that
 * setMotherShipVelocityFromHeading dispatches. Whatever the caller had in HL is discarded, and
 * nothing is written.
 *
 * LIVE-OUT: the pair. */

import { u16 } from "../../../core/int.js";
import { velocityForHeading } from "./velocityForHeading.js";
import { SLOWEST_VELOCITY_TABLE } from "./names.js";

// The fixed table, and record +2 of the object in IX, where the heading lives.
const VELOCITY_TABLE = SLOWEST_VELOCITY_TABLE;
const HEADING_IN_RECORD = 2;

export function velocityForHeadingAtSlowestSpeed(m, heading = m.mem8[u16(m.regs.ix + HEADING_IN_RECORD)]) {
  // Look the heading up in the fixed table; the pair comes back unchanged.
  return velocityForHeading(m, VELOCITY_TABLE, heading);
}

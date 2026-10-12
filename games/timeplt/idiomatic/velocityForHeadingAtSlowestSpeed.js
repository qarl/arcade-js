// SPDX-License-Identifier: GPL-3.0-only
/** velocityForHeadingAtSlowestSpeed — hand back the component pair an object's heading calls for, at the pace one fixed
 * velocity table sets; choosing it is all this entry does.
 *
 * ROM 0x5942-0x5947 (frozen lift translated/loc_5942.js): `ld hl,0x59d7 / jp 0x596e`, a two-
 * instruction shim into velocityForHeading. Grounding: [seen] (names.js ROUTINES 0x5942).
 *
 * Role in the machine: names.js places the table at 0x59D7 on the bottom rung of the game's
 * ladder of velocity tables, so this fixes the lowest pace. names.js records two readers:
 * armBomberSlotWhenTimerFires stores the pair straight into the slot it arms, and it is the era-0
 * word of the arm table at 0x46C4 that setMotherShipVelocityFromHeading dispatches. Whatever the
 * caller had in HL is discarded, and nothing is written.
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

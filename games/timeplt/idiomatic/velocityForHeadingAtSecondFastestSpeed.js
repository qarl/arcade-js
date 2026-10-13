// SPDX-License-Identifier: GPL-3.0-only
/** velocityForHeadingAtSecondFastestSpeed — hand back the perpendicular component pair an object's
 * heading calls for, at the second-fastest pace in the velocity-table ladder. Choosing that table is
 * all this entry does; an incoming pointer is discarded. LIVE-OUT: the pair.
 *
 * ROM 0x5965-0x596A (frozen lift translated/loc_5965.js): `ld hl,0x2e3e / jp 0x596e`. Grounding: [seen]
 * (names.js ROUTINES 0x5965).
 *
 * What it is: a two-instruction shim in front of velocityForHeading (ROM 0x596E). velocityForHeading
 * reads an object's heading (record byte +2, a point on a 256-step circle) and returns two samples a
 * quarter turn apart from whatever 256-word velocity table it is handed; the two samples are the
 * object's perpendicular velocity components, and the table's peak value is the speed. This entry
 * exists only to hand it ONE particular table.
 *
 * WHY "SECOND FASTEST": the mirror of flyAtSecondFastestSpeed (0x5860), which fixes the same table for
 * flyAlongHeading. The table at 0x2E3E peaks at 306, second only to 0x08FA's 331 however the ladder is
 * counted -- over the six ROM rungs 206/231/256/281/306/331, or over just the four the live shims
 * select. It is a rank over tables, not over delivered speed: the doubling shims loc_598e and
 * loc_5994 hand back up to 412 and 462 (names.js "why" for 0x5965).
 *
 * Role in the machine: the table here is the one at 0x2E3E (SECOND_FASTEST_VELOCITY_TABLE in
 * names.js), about 1.2 pixels per step in 8.8 fixed point -- the pace mechanisms.md gives the second
 * and third eras (1940, 1970). The same bytes are also a jump target on the anti-tamper path; on a
 * genuine image they are only ever read as data. Its siblings velocityForHeadingAtSlowestSpeed
 * (0x5942, table at 0x59D7, peak 206), loc_594e (0x594E, table at 0x5E00, peak 256) and
 * velocityForHeadingAtFastestSpeed (0x596B, table at 0x08FA, peak 331) are the same shim with the other live rungs.
 *
 * Whatever pointer the caller had in HL is overwritten by the table base before the jump, which is
 * why no incoming pointer survives.
 *
 * LIVE-OUT: the component pair velocityForHeading leaves (DE, BC), also returned; no memory is written.
 * Kept as the ROUTINES override of 0x5965: no idiomatic module calls it. Its two ROM transfers --
 * scrollWorldAtTheEraPace (eras 1 and 2) and setMotherShipVelocityFromHeading (era 3, a word of its
 * arm table at 0x46C4) -- each hand velocityForHeading the table directly in this port.
 */

import { velocityForHeading } from "./velocityForHeading.js";
import { SECOND_FASTEST_VELOCITY_TABLE } from "./names.js";

// The ROM's `ld hl,0x2e3e`: the 306-peak velocity table.
// Byte +2 of an object record: its heading, which velocityForHeading samples the table at.
const HEADING_CELL = 2;
const VELOCITY_TABLE = SECOND_FASTEST_VELOCITY_TABLE;

export function velocityForHeadingAtSecondFastestSpeed(m, heading = m.mem8[m.regs.ix + HEADING_CELL]) {
  // The ROM's `jp 0x596e`: a tail jump, so velocityForHeading's return is this entry's return; the
  // pair is also left in DE/BC.
  return velocityForHeading(m, VELOCITY_TABLE, heading);
}

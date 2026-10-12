// SPDX-License-Identifier: GPL-3.0-only
/** loc_594e — hand back the perpendicular component pair an object's heading calls for, at the pace
 * one fixed table of velocity samples sets. Choosing it is all this entry does; an incoming pointer
 * is discarded. LIVE-OUT: the pair.
 *
 * ROM 0x594E-0x5953 (frozen lift translated/loc_594e.js): `ld hl,0x5e00 / jp 0x596e`. Grounding: [seen]
 * (names.js ROUTINES 0x594E).
 *
 * What it is: a two-instruction shim in front of velocityForHeading (ROM 0x596E). velocityForHeading
 * reads an object's heading (record byte +2, a point on a 256-step circle) and returns two samples a
 * quarter turn apart from whatever 256-word velocity table it is handed; the two samples are the
 * object's perpendicular velocity components, and the table's peak value is the speed. This entry
 * exists only to hand it ONE particular table.
 *
 * Role in the machine: the table here is OPENING_ERA_VELOCITY_TABLE 0x5E00, the velocity ladder rung
 * that peaks at 256 (1.0 pixel per step in 8.8 fixed point) — the pace of the opening era (1910)
 * according to mechanisms.md's velocity ladder. Its siblings velocityForHeadingAtSecondFastestSpeed
 * (0x2E3E, peak 306) and velocityForHeadingAtFastestSpeed (0x08FA, peak 331) are the same shim with
 * the other two rungs the ship uses.
 *
 * Why it keeps a hex name: it is the twin of loc_5854, and its rank is count-dependent the same way --
 * second-slowest over the live shims (206/256/306/331), third-slowest over all six ROM tables (the
 * 231/281 shims at 0x5948/0x595F are never entered) -- so a rank name would not hold (names-debt.txt).
 *
 * Whatever pointer the caller had in HL is overwritten by the table base before the jump, which is
 * why no incoming pointer survives.
 *
 * LIVE-OUT: the component pair velocityForHeading leaves (DE, BC), also returned; no memory is written.
 * Kept as the ROUTINES override of 0x594E: no idiomatic module calls
 * it. Its two ROM transfers -- scrollWorldAtTheEraPace
 * (era 0) and setMotherShipVelocityFromHeading (eras 1 and 2, words of its arm table at 0x46C4) --
 * each hand velocityForHeading the table directly in this port.
 */

import { velocityForHeading } from "./velocityForHeading.js";
import { OPENING_ERA_VELOCITY_TABLE } from "./names.js";

// The ROM's `ld hl,0x5e00`: the 256-peak velocity table.
// Byte +2 of an object record: its heading, which velocityForHeading samples the table at.
const HEADING_CELL = 2;
const VELOCITY_TABLE = OPENING_ERA_VELOCITY_TABLE;

export function loc_594e(m, heading = m.mem8[m.regs.ix + HEADING_CELL]) {
  // The ROM's `jp 0x596e`: a tail jump, so velocityForHeading's return is this entry's return.
  return velocityForHeading(m, VELOCITY_TABLE, heading);
}

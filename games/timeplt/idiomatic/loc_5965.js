// SPDX-License-Identifier: GPL-3.0-only
/** loc_5965 — hand back the perpendicular component pair an object's heading calls for, at the pace one fixed table
 * of velocity samples sets. Choosing it is all this entry does; an incoming pointer is discarded. LIVE-OUT: the pair.
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
 * Role in the machine: the table here is the one at 0x2E3E (SECOND_FASTEST_VELOCITY_TABLE in names.js),
 * the velocity ladder rung that peaks at 306 (about 1.2 pixels per step in 8.8 fixed point) — the
 * pace mechanisms.md gives the second and third eras (1940, 1970). The same bytes are also a jump
 * target on the anti-tamper path; on a genuine image they are only ever read as data. Its siblings
 * loc_594e (0x5E00, peak 256) and loc_596b (0x08FA, peak 331) are the same shim with the other two
 * rungs the ship uses.
 *
 * Whatever pointer the caller had in HL is overwritten by the table base before the jump, which is
 * why no incoming pointer survives.
 *
 * LIVE-OUT: the component pair velocityForHeading leaves (DE, BC), also returned; no memory is written.
 * Kept as the ROUTINES override of 0x5965: no idiomatic module calls
 * it, because scrollWorldAtTheEraPace hands velocityForHeading the table itself.
 */

import { velocityForHeading } from "./velocityForHeading.js";
import { SECOND_FASTEST_VELOCITY_TABLE } from "./names.js";

// The ROM's `ld hl,0x2e3e`: the 306-peak velocity table.
// Byte +2 of an object record: its heading, which velocityForHeading samples the table at.
const HEADING_CELL = 2;
const VELOCITY_TABLE = SECOND_FASTEST_VELOCITY_TABLE;

export function loc_5965(m, heading = m.mem8[m.regs.ix + HEADING_CELL]) {
  // The ROM's `jp 0x596e`: a tail jump, so velocityForHeading's return is this entry's return; the
  // pair is also left in DE/BC.
  return velocityForHeading(m, VELOCITY_TABLE, heading);
}

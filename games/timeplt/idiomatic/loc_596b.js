// SPDX-License-Identifier: GPL-3.0-only
/** loc_596b — hand back the perpendicular component pair an object's heading calls for, at the pace one fixed table
 * of velocity samples sets. Choosing it is all this entry does; an incoming pointer is discarded. LIVE-OUT: the pair.
 *
 * ROM 0x596B-0x596D (frozen lift translated/loc_596b.js): a single `ld hl,0x08fa`, after which execution
 * FALLS THROUGH into velocityForHeading, whose code starts at the very next address, 0x596E — there is
 * no jump at all. Grounding: [seen] (names.js ROUTINES 0x596B).
 *
 * What it is: a one-instruction shim in front of velocityForHeading. velocityForHeading reads an
 * object's heading (record byte +2, a point on a 256-step circle) and returns two samples a quarter
 * turn apart from whatever 256-word velocity table it is handed; the two samples are the object's
 * perpendicular velocity components, and the table's peak value is the speed. This entry exists only
 * to hand it ONE particular table.
 *
 * Role in the machine: the table here is the one at 0x08FA (VELOCITY_TABLE_08FA in names.js), the
 * top rung of the velocity ladder, peaking at 331 (about 1.3 pixels per step in 8.8 fixed point) —
 * the pace mechanisms.md gives the fourth and fifth eras (1982, 2001). The same bytes double as the
 * anti-tamper checksum-failure landing (loc_08fa); on a genuine image they are only read as data.
 * Its siblings loc_594e (0x5E00, peak 256) and loc_5965 (0x2E3E, peak 306) are the same shim with
 * the other two rungs the ship uses.
 *
 * Whatever pointer the caller had in HL is overwritten by the table base, which is why no incoming
 * pointer survives.
 *
 * LIVE-OUT: the component pair velocityForHeading leaves (DE, BC), also returned — the pair is the
 * whole product; no memory is written.
 * Kept as the ROUTINES override of 0x596B: no idiomatic module calls
 * it. Its two ROM transfers -- scrollWorldAtTheEraPace
 * (eras 3 and 4) and setMotherShipVelocityFromHeading (era 4, a word of its arm table at 0x46C4) --
 * each hand velocityForHeading the table directly in this port.
 */

import { velocityForHeading } from "./velocityForHeading.js";
import { VELOCITY_TABLE_08FA } from "./names.js";

// The ROM's `ld hl,0x08fa`: the 331-peak velocity table.
// Byte +2 of an object record: its heading, which velocityForHeading samples the table at.
const HEADING_CELL = 2;
const VELOCITY_TABLE = VELOCITY_TABLE_08FA;

export function loc_596b(m, heading = m.mem8[m.regs.ix + HEADING_CELL]) {
  // The fall-through into 0x596E: velocityForHeading runs next, so its return is this entry's
  // return; the pair is also left in DE and BC.
  return velocityForHeading(m, VELOCITY_TABLE, heading);
}

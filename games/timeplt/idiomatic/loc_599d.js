// SPDX-License-Identifier: GPL-3.0-only
/** loc_599d — take an object's heading from its own record and hand back the doubled component
 * pair the table the caller is already holding gives for it. That pointer is carried through
 * rather than replaced, so the pace stays the caller's choice. LIVE-OUT: the pair.
 *
 * ROM 0x599D-0x59C4 (frozen lift translated/loc_599d.js: `ld a,(ix+0x02)`, then straight on into
 * the 0x59A0 body the span ends with). Grounding: [seen] (names.js ROUTINES 0x599d).
 *
 * ROLE IN THE MACHINE. This is the single instruction sitting in front of doubledVelocityForHeading
 * (0x59A0): it loads the heading — a point on a 256-step circle kept at byte +2 of the object
 * record IX points at — into A, and lets execution run on into the lookup, which reads two
 * perpendicular 16-bit velocity components from the table in HL and doubles each. The shims
 * loc_598e and loc_5994 seat HL themselves and jump here; entering at 0x599D directly keeps
 * whatever table the caller left in HL. That forwarding of the table pointer is, per names.js,
 * what separates this entry from the sibling shims that choose a table themselves.
 *
 * `table` carries the ROM's HL (the velocity table) and `record` its IX (the object record).
 * Kept as the ROUTINES override of 0x599D: no idiomatic module calls
 * it, because loc_598e and loc_5994 run the doubled lookup directly.
 */

import { doubledVelocityForHeading } from "./doubledVelocityForHeading.js";

// Byte +2 of an object record: its heading.
const HEADING_CELL = 2;

export function loc_599d(m, table = m.regs.hl, record = m.regs.ix) {
  // Read the heading off the record and run the doubled lookup in the caller's table; the pair
  // comes back (and is left in DE and BC by the lookup).
  return doubledVelocityForHeading(m, table, m.mem8[record + HEADING_CELL]);
}

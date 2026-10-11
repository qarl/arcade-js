// SPDX-License-Identifier: GPL-3.0-only
/** doubledVelocityForHeading — the perpendicular pair the caller's table gives for a heading
 * handed straight in as a value, at TWICE the length the table carries; the doubling wraps at
 * sixteen bits rather than saturating. Which of the pair is the screen's across and which its
 * down is not settled here. LIVE-OUT: the pair; no writes.
 *
 * ROM 0x59A0-0x59C4 (frozen lift translated/loc_59a0.js). Grounding: [seen] (names.js ROUTINES).
 *
 * ROLE IN THE MACHINE. A heading is a point on a 256-step circle. The caller's table holds one
 * two-byte component per heading step; velocityForHeading reads it twice, once at the heading and
 * once a quarter turn away, giving two perpendicular components. This entry is the same lookup
 * with each component shifted left once (ROM `sla e / rl d`, `sla c / rl b`). Three small shims
 * each fix a table and tail-jump here. The calls at 0x3DAE, 0x3F63 and 0x3F68 bank the returned pair
 * straight into an object record's +0x0A..+0x0D, which flyAlongStoredVelocity then adds to the object
 * at each step (layOutEnemyAimPointsFromScrollAngle instead uses loc_59d1's pair to place aim points) --
 * so the doubling is the speed those objects fly at, not an artefact.
 *
 * Parameters: `table` is the base of the component table (the ROM's HL) and `heading` the heading
 * byte (the ROM's A), handed in as a value rather than read off an object.
 */

import { u16 } from "../../../core/int.js";
import { velocityForHeading } from "./velocityForHeading.js";

export function doubledVelocityForHeading(m, table = m.regs.hl, heading = m.regs.a) {
  const { regs } = m;
  // Look the pair up at the table's own scale: de at the heading, bc a quarter turn from it.
  const [alongFirstAxis, alongSecondAxis] = velocityForHeading(m, table, heading);
  // Double each 16-bit component; a carry out of bit 15 is dropped, as the ROM's shift pair drops
  // it. The pair is returned and also left in DE and BC, where the ROM's callers find it.
  return [regs.de = u16(2 * alongFirstAxis), regs.bc = u16(2 * alongSecondAxis)];
}

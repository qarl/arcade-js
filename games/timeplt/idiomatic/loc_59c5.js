// SPDX-License-Identifier: GPL-3.0-only
/** loc_59c5 — hand back the doubled component pair a heading handed straight in calls for, at the
 * pace one fixed table of samples sets; choosing that table is all this entry does. LIVE-OUT: the pair.
 *
 * ROM 0x59C5-0x59CA (frozen lift translated/loc_59c5.js: `ld hl,0x59d7 / jp 0x59a0`).
 * Grounding: [seen] (names.js ROUTINES 0x59c5).
 *
 * ROLE IN THE MACHINE. doubledVelocityForHeading (0x59A0) turns a heading — a point on a 256-step
 * circle — into two perpendicular 16-bit velocity components read from a table of samples, each
 * doubled. It takes the table in HL and the heading in A. This shim seats the table and tail-jumps
 * in, so the heading is whatever value the caller put in A; unlike loc_598e it does not read an
 * object record. Its caller is fireBomberShotWhenClearOfPlayer, which hands in the heading
 * it has just aimed and stores the returned pair as the new enemy's velocity.
 *
 * The table is SLOWEST_VELOCITY_TABLE (0x59D7), the ROM table of 256 16-bit velocity words — the same table
 * loc_598e seats. loc_59cb and loc_59d1 are this entry with the other two table immediates.
 */

import { doubledVelocityForHeading } from "./doubledVelocityForHeading.js";
import { SLOWEST_VELOCITY_TABLE } from "./names.js";

export function loc_59c5(m, heading = m.regs.a) {
  // `ld hl,0x59d7 / jp 0x59a0`: fixed table, caller's heading (the ROM's A). The tail jump means
  // the lookup's `ret` returns to our caller with the pair in DE/BC; here it is also returned.
  return doubledVelocityForHeading(m, SLOWEST_VELOCITY_TABLE, heading);
}

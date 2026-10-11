// SPDX-License-Identifier: GPL-3.0-only
/** loc_59cb — hand back the doubled component pair a heading handed straight in calls for, at the
 * pace one fixed table of samples sets; choosing that table is all this entry does. LIVE-OUT: the pair.
 *
 * ROM 0x59CB-0x59D0 (frozen lift translated/loc_59cb.js: `ld hl,0x5c00 / jp 0x59a0`).
 * Grounding: [seen] (names.js ROUTINES 0x59cb).
 *
 * ROLE IN THE MACHINE. One of three sibling shims (loc_59c5, loc_59cb, loc_59d1) that each seat a
 * different velocity table in HL and tail-jump — nothing pushed — into doubledVelocityForHeading
 * (0x59A0). That body looks up the two perpendicular 16-bit velocity components a heading (a
 * point on a 256-step circle, handed in by the caller in A) calls for, and doubles each. The
 * caller here is fireCraftShotWhenAimedNearPlayer, which uses this entry while ERA_INDEX is 0
 * and loc_59d1 otherwise, and stores the returned pair as the launched enemy's velocity.
 *
 * The table is VELOCITY_TABLE_5C00 (0x5C00): a ROM velocity table whose era names.js records as
 * not determined, also read by loc_5994.
 */

import { doubledVelocityForHeading } from "./doubledVelocityForHeading.js";
import { VELOCITY_TABLE_5C00 } from "./names.js";

// The table this shim fixes: the ROM's `ld hl,0x5c00`.
const VELOCITY_TABLE = VELOCITY_TABLE_5C00;

export function loc_59cb(m, heading = m.regs.a) {
  // Fixed table, the caller's heading; the doubled pair is returned (and left in DE/BC).
  return doubledVelocityForHeading(m, VELOCITY_TABLE, heading);
}

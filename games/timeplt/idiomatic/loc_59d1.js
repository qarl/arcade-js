// SPDX-License-Identifier: GPL-3.0-only
/** loc_59d1 — hand back the doubled component pair a heading handed straight in calls for, at the
 * pace one fixed table of samples sets; choosing that table is all this entry does. LIVE-OUT: the pair.
 *
 * ROM 0x59D1-0x59D6 (frozen lift translated/loc_59d1.js: `ld hl,0x5e00 / jp 0x59a0`).
 * Grounding: [seen] (names.js ROUTINES 0x59d1).
 *
 * ROLE IN THE MACHINE. One of three sibling shims (loc_59c5, loc_59cb, loc_59d1) that each seat a
 * different velocity table in HL and tail-jump — nothing pushed — into doubledVelocityForHeading
 * (0x59A0). That body looks up the two perpendicular 16-bit velocity components a heading (a
 * point on a 256-step circle, handed in by the caller in A) calls for, and doubles each.
 * Callers: fireCraftShotWhenAimedNearPlayer (when ERA_INDEX is nonzero) and
 * layOutEnemyAimPointsFromPlayerHeading, which asks for the player's heading and the heading a
 * quarter turn from it to place enemy aim points.
 *
 * The table is OPENING_ERA_VELOCITY_TABLE (0x5E00), the ROM table scrollWorldAtTheEraPace uses as
 * the opening era's world pace; names.js lists this entry, loc_58b6 and loc_5854 as its other
 * readers.
 */

import { doubledVelocityForHeading } from "./doubledVelocityForHeading.js";
import { OPENING_ERA_VELOCITY_TABLE } from "./names.js";

// The table this shim fixes: the ROM's `ld hl,0x5e00`.
const VELOCITY_TABLE = OPENING_ERA_VELOCITY_TABLE;

export function loc_59d1(m, heading = m.regs.a) {
  // Fixed table, the caller's heading; the doubled pair is returned (and left in DE/BC).
  return doubledVelocityForHeading(m, VELOCITY_TABLE, heading);
}

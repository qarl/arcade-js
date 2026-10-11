// SPDX-License-Identifier: GPL-3.0-only
import { SECOND_FASTEST_VELOCITY_TABLE } from "./names.js";
/**
 * flyAtSecondFastestSpeed — fly one object a single step at the second-fastest pace in the ladder.
 *
 * WHAT IT IS: ROM 0x5860-0x5865, tag [seen] (names.js ROUTINES 0x5860). The ROM routine is the six bytes
 * 21 3E 2E C3 BC 58 -- `ld hl,0x2e3e / jp 0x58bc`: it fixes one table of velocity samples and hands over
 * to the shared flier, flyAlongHeading. Choosing that table is all this entry does, and an incoming
 * pointer (the ROM's HL) is discarded.
 *
 * WHY "SECOND FASTEST": the table at 0x2E3E peaks at 306, second only to 0x08FA's 331 however the ladder
 * is counted -- over the six ROM rungs 206/231/256/281/306/331, or over just the four the live shims
 * select. It is a rank over tables, not over movement: loc_58aa's doubled 206 moves farther per step
 * (names.js "why" for 0x5860).
 *
 * ROLE IN THE MACHINE: its one entry is the jump at 0x2A19 in steerEra4CraftTowardAimHeadingThenFly (0x29F7), which the era-4 arm
 * of the per-slot handler table at 0x2914 (serviceEra4EnemyCraftSlot, 0x29D5) calls. steerEra4CraftTowardAimHeadingThenFly alternates on bit 1 of the frame tick between this entry and
 * loc_58aa (the bottom-rung table under the double-velocity mover), so the object does not stay on one
 * rung.
 *
 * LIVE-OUT: memory (the object's coordinates, written by the flier).
 */

import { flyAlongHeading } from "./flyAlongHeading.js";

/*
 * The velocity table at ROM 0x2E3E -- also the era-1/2 pace of scrollWorldAtTheEraPace. It keeps a hex
 * name because the same address is the tamper-trap jump target in showCreditLine (names.js).
 */
const VELOCITY_TABLE = SECOND_FASTEST_VELOCITY_TABLE;

/*
 * `object` is the object's record (the ROM's IX) and `sprite` its sprite entry (the ROM's IY), passed
 * straight through to the flier, which reads the heading from the record and moves the sprite entry.
 */
export function flyAtSecondFastestSpeed(m, object = m.regs.ix, sprite = m.regs.iy) {
  flyAlongHeading(m, VELOCITY_TABLE, object, sprite);
}

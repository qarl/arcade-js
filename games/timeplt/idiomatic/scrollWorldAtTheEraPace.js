// SPDX-License-Identifier: GPL-3.0-only
/** scrollWorldAtTheEraPace — move the world past the ship at the pace the era sets. It READS the heading rather than
 * deciding it: some paths in write it first and others arrive with whatever is already there. One of
 * three fixed velocity tables is picked from ERA_INDEX alone — the opening era its own, the next two sharing a second,
 * everything from the fourth era (ERA_INDEX 3) up sharing a third — and the pair that table gives for the ship's heading is handed on to
 * be negated into the world scroll. The three tables are one curve at three sizes: peaks of 256, 306 and 331, within 0.75%
 * of pure scaling of one another, rungs on a ladder of six that climbs in steps of 25. What the era picks is a rung.
 * LIVE-OUT: memory.
 *
 * ROM 0x1F42-0x1F54 (with the three table-loading stubs at 0x594E / 0x5965 / 0x596B).
 * Grounding: [seen] (names.js ROUTINES 0x1f42).
 *
 * ROLE IN THE MACHINE. The player's ship never moves on screen -- its sprite stays pinned while
 * the world scrolls past it. So "flying" is this routine: on every pass of the live ship's handler, the
 * ship's velocity is looked up and applied, reversed, to the world. It is reached from
 * dispatchPlayerFrameByState (stick centred), turnShipTowardTargetHeading, snapHeadingOntoTheTurnTarget
 * and the demo autopilot flyDemoShipByScript. There is no throttle: pace changes only with the era.
 */

import { u16 } from "../../../core/int.js";
import { negateVelocityIntoWorldScrollThenDressSprite } from "./negateVelocityIntoWorldScrollThenDressSprite.js";
import { velocityForHeading } from "./velocityForHeading.js";
import { ERA_INDEX, SECOND_FASTEST_VELOCITY_TABLE, OPENING_ERA_VELOCITY_TABLE, VELOCITY_TABLE_08FA } from "./names.js";

// Era 0 (1910): table at 0x5E00, peak 256. Eras 1-2: 0x2E3E, peak 306. Eras 3-4: 0x08FA, peak 331.
const OPENING_ERA_PACE = OPENING_ERA_VELOCITY_TABLE;
const EARLY_ERA_PACE = SECOND_FASTEST_VELOCITY_TABLE;
const LATER_ERA_PACE = VELOCITY_TABLE_08FA;
const FIRST_LATER_ERA = 3;
// The heading is byte +2 of the flying record (for the player, PLAYER_HEADING 0xA802 [seen]).
const HEADING_IN_RECORD = 2;

export function scrollWorldAtTheEraPace(m, heading = m.mem8[u16(m.regs.ix + HEADING_IN_RECORD)]) {
  // Step 1 -- pick the pace table from the era (ROM: `and a` / `jp z` for era 0, `cp 0x03` / `jp c`).
  const era = m.mem8[ERA_INDEX];
  let pace = LATER_ERA_PACE;
  if (era === 0) pace = OPENING_ERA_PACE;
  else if (era < FIRST_LATER_ERA) pace = EARLY_ERA_PACE;

  // Step 2 -- look up the two perpendicular velocity components for the heading in that table,
  // then hand them to the continuation (ROM 0x1F55, pushed as the return address before the
  // lookup), which negates both into the world scroll cells and dresses the ship's sprite.
  const [alongY, alongX] = velocityForHeading(m, pace, heading);
  negateVelocityIntoWorldScrollThenDressSprite(m, alongY, alongX);
}

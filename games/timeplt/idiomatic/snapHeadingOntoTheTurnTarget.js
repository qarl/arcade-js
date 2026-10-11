// SPDX-License-Identifier: GPL-3.0-only
/**
 * snapHeadingOntoTheTurnTarget — ROM 0x1F3E [seen]
 *
 * WHAT IT IS. The arm of the player's turn that ends it: the ship's heading is set exactly to the
 * heading it was turning toward, and the world is then scrolled for it. The ROM is two instructions,
 * `ld a,b` / `ld (0xa802),a`, falling into the world scroll at 0x1F42 (scrollWorldAtTheEraPace [seen]).
 *
 * ROLE IN THE MACHINE. The other arms of the turn STEP the live heading by 3 or 4 (chosen from
 * ERA_INDEX's low nibble) toward a target taken from the direction table at 0x1F2E. Targets are 32
 * apart and 3 does not divide 32, so a walk of 3s can land 2 short, fail the guard and overshoot to
 * one past. This arm is taken when the live heading is one either side of the target (live minus
 * target is 0xFF or 0x01), and writes the target itself -- a snap.
 * The one transfer that targets it is turnShipTowardTargetHeading's own `jp c,0x1f3e` at 0x1F22 (the
 * tamper path through loc_1f2e can also fall into it), and the port runs the snap inline there, so
 * this file stands for that arm (names.js).
 *
 * PARAMETER: `target` -- the heading being turned toward (the ROM's B, loaded at 0x1F05 and not
 * written again before here). LIVE-OUT: memory.
 * Kept as the ROUTINES override of 0x1F3E: no idiomatic module calls
 * it, because turnShipTowardTargetHeading runs the snap inline.
 */

import { scrollWorldAtTheEraPace } from "./scrollWorldAtTheEraPace.js";
import { PLAYER_HEADING } from "./names.js";

export function snapHeadingOntoTheTurnTarget(m, target = m.regs.b) {
  const { mem8 } = m;
  // The snap: PLAYER_HEADING (0xA802 [seen]) takes the target outright, then the shared tail scrolls
  // the world at the era's pace along the heading just written.
  mem8[PLAYER_HEADING] = target;
  scrollWorldAtTheEraPace(m, target);
}

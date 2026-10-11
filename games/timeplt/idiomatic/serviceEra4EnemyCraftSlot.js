// SPDX-License-Identifier: GPL-3.0-only
/** serviceEra4EnemyCraftSlot — service one object slot by its lifecycle byte: idle when free, release when held,
 * step when dying, and when live steer it, retire it on the line, else animate and try two launches. */

/*
 * ROM 0x29D5-0x29F6, grounding [seen] (names.js ROUTINES 0x29d5).
 *
 * ROLE. Word 4 of the era table at 0x2914 that dispatchSeatedSlotByEraIndex runs when ERA_INDEX
 * (0xAD04) is 4 -- the fifth and last era (A.D. 2001, flying saucers, in gameplay.md). Called once per
 * round-engine pass per seated enemy-craft slot. Same skeleton as the other era services, with two differences:
 * steering and flying are one call (steerEra4CraftTowardAimHeadingThenFly), and instead of pointing the sprite along a
 * heading it plays a four-frame shape cycle (animateSelectedShapeCycle).
 *
 * PARAMETERS. `record` is the slot's 16-byte object record (lifecycle byte at +0); `entry` is its
 * two-byte sprite entry.
 *
 * LIVE-OUT: memory only -- the slot's record and sprite entry, and whatever the launch helpers seat.
 */

import { releaseHeldObject } from "./releaseHeldObject.js";
import { stepDyingObjectState } from "./stepDyingObjectState.js";
import { steerEra4CraftTowardAimHeadingThenFly } from "./steerEra4CraftTowardAimHeadingThenFly.js";
import { hasReachedRetireLine } from "./hasReachedRetireLine.js";
import { retireSlotAndSubPixel } from "./retireSlotAndSubPixel.js";
import { animateSelectedShapeCycle } from "./animateSelectedShapeCycle.js";
import { fireCraftShotWhenAimedNearPlayer } from "./fireCraftShotWhenAimedNearPlayer.js";
import { launchAttackerIntoFreeSlot } from "./launchAttackerIntoFreeSlot.js";

// Lifecycle-byte values (record +0); any other nonzero value is a death countdown.
const FREE = 0;
const HELD = 0xfe;
const LIVE = 0xff;

export function serviceEra4EnemyCraftSlot(m, record = m.regs.ix, entry = m.regs.iy) {
  // Decode the lifecycle byte (ROM: `and a`, `inc a`, `inc a`). Free: nothing to do. Held: count
  // the release delay down, turning live when it expires (releaseHeldObject, 0x2B52). Any other
  // non-live value: one step of the dying state (stepDyingObjectState, 0x2B93). Both are ROM tail
  // jumps, so their result is returned as this routine's.
  const state = m.mem8[record];
  if (state === FREE) return;
  if (state === HELD) return releaseHeldObject(m, record);
  if (state !== LIVE) return stepDyingObjectState(m, record, entry);

  // Live craft. steerEra4CraftTowardAimHeadingThenFly (0x29F7) turns the slot toward its aim heading and flies it a
  // step, in one call.
  steerEra4CraftTowardAimHeadingThenFly(m, entry, record);
  // Retire test: a craft on either fixed retire line has left play. hasReachedRetireLine (0x2B83)
  // answers with the carry flag and the ROM tail-jumps (`jp c,0x2BDE`) to retireSlotAndSubPixel,
  // which zeroes the slot; nothing else runs for it.
  if (hasReachedRetireLine(m, entry)) return retireSlotAndSubPixel(m, record, entry);
  // Still in play: give the sprite entry the current frame of a four-frame shape cycle
  // (animateSelectedShapeCycle, 0x2B38); one gated shot when aimed near the player (0x3ED6);
  // then the attacker launch into a free slot on this object's turn (launchAttackerIntoFreeSlot,
  // 0x4243). The ROM ends with a plain `ret`, so nothing is handed back.
  animateSelectedShapeCycle(m, record, entry);
  fireCraftShotWhenAimedNearPlayer(m, record, entry);
  launchAttackerIntoFreeSlot(m, record, entry);
}

// SPDX-License-Identifier: GPL-3.0-only
/** serviceEra3EnemyCraftSlot — the era-3 step for one object slot, dispatched on the slot's lifecycle byte at ix+0:
 * an idle slot does nothing; a live slot (0xff) is steered and flown a step, then either retired at
 * the line or given a shot attempt, dressed and given a spawn attempt; 0xfe releases a held slot; a lower value is a death
 * countdown step. LIVE-OUT: memory. */

/*
 * ROM 0x29B0-0x29D4, grounding [seen] (names.js ROUTINES 0x29b0).
 *
 * ROLE. Word 3 of the era table at 0x2914 that dispatchSeatedSlotByEraIndex runs when ERA_INDEX's low
 * three bits are 3 -- the fourth era (A.D. 1982/83, jet fighters, in gameplay.md, whose enemies are
 * "as fast and manoeuvrable as you"). Called once per round-engine pass per seated enemy-craft slot. Same
 * skeleton as the other era services; this era flies its craft with flyAtFastestSpeed and draws
 * them with dressSpriteForCoarseHeading.
 *
 * The body below runs, for a live slot, in the ROM's call order at 0x29BF-0x29D4: steer, fly,
 * retire test, shot attempt, dress the sprite, era-weapon launch.
 *
 * PARAMETERS. `record` is the slot's 16-byte object record (lifecycle byte at +0); `entry` is its
 * two-byte sprite entry.
 *
 * LIVE-OUT: memory only.
 */

import { steerTowardAimHeading } from "./steerTowardAimHeading.js";
import { flyAtFastestSpeed } from "./flyAtFastestSpeed.js";
import { hasReachedRetireLine } from "./hasReachedRetireLine.js";
import { retireSlotAndSubPixel } from "./retireSlotAndSubPixel.js";
import { fireCraftShotWhenAimedNearPlayer } from "./fireCraftShotWhenAimedNearPlayer.js";
import { dressSpriteForCoarseHeading } from "./dressSpriteForCoarseHeading.js";
import { launchAttackerIntoFreeSlot } from "./launchAttackerIntoFreeSlot.js";
import { releaseHeldObject } from "./releaseHeldObject.js";
import { stepDyingObjectState } from "./stepDyingObjectState.js";

// Lifecycle-byte values (record +0); any other nonzero value is a death countdown.
const IDLE = 0;
const LIVE = 0xff;
const HELD = 0xfe;

export function serviceEra3EnemyCraftSlot(m, record = m.regs.ix, entry = m.regs.iy) {
  // Decode the lifecycle byte (ROM: `and a`, `inc a`, `inc a`). Idle: nothing to do. Held: count
  // the release delay down, turning live when it expires (releaseHeldObject, 0x2B52). Anything else
  // that is not live: one step of the dying state (stepDyingObjectState, 0x2B93). The last two are
  // ROM tail jumps, so their result is returned as this routine's.
  const state = m.mem8[record];
  if (state === IDLE) return;
  if (state !== LIVE) {
    if (state === HELD) return releaseHeldObject(m, record);
    return stepDyingObjectState(m, record, entry);
  }
  // Live craft. Turn one step toward the aim heading on every call (steerTowardAimHeading, 0x2BEF),
  // then move one step on the top rung of the velocity tables (flyAtFastestSpeed, 0x58A4).
  steerTowardAimHeading(m, record);
  flyAtFastestSpeed(m, record, entry);
  // Retire test: a craft on either fixed retire line has left play. hasReachedRetireLine (0x2B83)
  // answers with the carry flag and the ROM tail-jumps (`jp c,0x2BDE`) to retireSlotAndSubPixel,
  // which zeroes the slot; nothing else runs for it.
  if (hasReachedRetireLine(m, entry)) return retireSlotAndSubPixel(m, record, entry);
  // Still in play: one gated shot when aimed near the player (0x3ED6); point the sprite
  // along the heading rounded to sixteen sectors (dressSpriteForCoarseHeading, 0x2AFC); then the
  // era-weapon launch into a free era-object slot on this object's turn
  // (launchAttackerIntoFreeSlot, 0x4243).
  fireCraftShotWhenAimedNearPlayer(m, record, entry);
  dressSpriteForCoarseHeading(m, record, entry);
  return launchAttackerIntoFreeSlot(m, record, entry);
}

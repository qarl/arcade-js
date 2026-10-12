// SPDX-License-Identifier: GPL-3.0-only
/** serviceEra0EnemyCraftSlot — the era-0 per-object update, branched on the object's status byte: an empty slot is
 * left alone, a held object counts its release delay down, a dying one is stepped, and an active
 * craft is steered, flown and refreshed, then given a shot attempt and an era-weapon launch
 * attempt, or retired on the pass it reaches the line. LIVE-OUT: memory. */

/*
 * ROM 0x2927-0x294B, grounding [seen] (names.js ROUTINES 0x2927).
 *
 * ROLE. Word 0 of the era table at 0x2914 that dispatchSeatedSlotByEraIndex runs when ERA_INDEX's low
 * three bits are 0 -- the first era (A.D. 1910, biplanes, in gameplay.md). It is called once per round-engine
 * pass for each enemy-craft slot the seatCraftSlotNThenDispatchByEra entries seat, and does that one
 * slot's whole pass of work.
 *
 * PARAMETERS. `record` is the slot's 16-byte object record (its first byte is the status byte below);
 * `entry` is the slot's two-byte sprite entry.
 *
 * THE STATUS BYTE (record +0). 0x00 = empty slot; 0xFF = active craft; 0xFE = held (parked, waiting
 * out a release delay); any other value = a dying object's countdown. The ROM decodes it with
 * `and a` (zero?) then `inc a` (was it 0xFF?) then `inc a` again (was it 0xFE?).
 *
 * LIVE-OUT: memory only -- the slot's record and sprite entry, and whatever the launch helpers seat.
 */

import { steerTowardAimHeading } from "./steerTowardAimHeading.js";
import { flyAtSlowestSpeed } from "./flyAtSlowestSpeed.js";
import { hasReachedRetireLine } from "./hasReachedRetireLine.js";
import { retireSlotAndSubPixel } from "./retireSlotAndSubPixel.js";
import { fireCraftShotWhenAimedNearPlayer } from "./fireCraftShotWhenAimedNearPlayer.js";
import { refreshSpriteFromHeading } from "./refreshSpriteFromHeading.js";
import { launchAttackerIntoFreeSlot } from "./launchAttackerIntoFreeSlot.js";
import { releaseHeldObject } from "./releaseHeldObject.js";
import { stepDyingObjectState } from "./stepDyingObjectState.js";

// Status-byte values (record +0), as decoded at 0x292A-0x2930.
const EMPTY = 0;
const HELD = 0xfe;
const ACTIVE = 0xff;

export function serviceEra0EnemyCraftSlot(m, record = m.regs.ix, entry = m.regs.iy) {
  // Non-active slots. An empty slot has nothing to do (`ret z`). A held object counts its release
  // delay down and becomes active when it expires (releaseHeldObject, 0x2B52). Any other value is a
  // dying object's countdown, stepped by stepDyingObjectState (0x2B93). In the ROM the last two are
  // tail jumps, so the handler's result is this routine's result.
  const status = m.mem8[record];
  if (status === EMPTY) return;
  if (status === HELD) return releaseHeldObject(m, record);
  if (status !== ACTIVE) return stepDyingObjectState(m, record, entry);

  // Active craft, movement. Turn the heading one step toward the aim heading, the short way round
  // (steerTowardAimHeading, 0x2BEF) -- on every call in this era -- then fly one step at the slowest
  // of the velocity-table speeds (flyAtSlowestSpeed, 0x5840).
  steerTowardAimHeading(m, record);
  flyAtSlowestSpeed(m, record, entry);
  // Retire test. The playfield scrolls around the player's fixed ship, so a craft that drifts onto
  // either of two fixed retire lines has left play; hasReachedRetireLine (0x2B83) answers that with
  // the Z80 carry flag, and on carry the ROM tail-jumps to retireSlotAndSubPixel (0x2BDE), which
  // zeroes the slot's occupancy byte and coordinates. Nothing else runs for a retired slot.
  if (hasReachedRetireLine(m, entry)) return retireSlotAndSubPixel(m, record, entry);
  // Still in play. One gated attempt to fire a shot into the enemy-shot bank when this craft is
  // aimed near the player (fireCraftShotWhenAimedNearPlayer, 0x3ED6); then store the shape and
  // attribute that draw the craft pointing along its heading into its sprite entry
  // (refreshSpriteFromHeading, 0x2A3C); then, on this object's turn and once the shared spawn
  // cooldown has expired, launch an era weapon into a free era-object slot
  // (launchAttackerIntoFreeSlot, 0x4243).
  fireCraftShotWhenAimedNearPlayer(m, record, entry);
  refreshSpriteFromHeading(m, entry, record);
  return launchAttackerIntoFreeSlot(m, record, entry);
}

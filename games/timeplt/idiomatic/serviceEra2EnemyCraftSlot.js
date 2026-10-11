// SPDX-License-Identifier: GPL-3.0-only
/** serviceEra2EnemyCraftSlot — run one object slot, dispatched on its state byte (ix+0): the empty value does
 * nothing; the active value flies it — steered toward its aim unless FRAME_TICK's low two bits read 3, moved at the
 * slow speed, retired once it reaches a retire line, else its sprite is dressed and two launch
 * attempts run; the held value releases it; any other value steps its dying state. LIVE-OUT: memory. */

/*
 * ROM 0x2984-0x29AF, grounding [seen] (names.js ROUTINES 0x2984).
 *
 * ROLE. Word 2 of the era table at 0x2914 that dispatchSeatedSlotByEraIndex runs when ERA_INDEX's low
 * three bits are 2 -- the third era (A.D. 1970, helicopters, in gameplay.md). Called once per round-engine
 * pass per seated enemy-craft slot; it does that slot's whole pass of work. It has the same skeleton as
 * the other era services and differs from era 0 in two places: steering is skipped when
 * FRAME_TICK's low two bits read 3, and the sprite is dressed by dressSpriteForFineHeading instead of refreshSpriteFromHeading.
 *
 * PARAMETERS. `record` is the slot's 16-byte object record (state byte at +0); `entry` is the
 * slot's two-byte sprite entry.
 *
 * THE STATE BYTE (record +0). 0x00 empty; 0xFF active; 0xFE held (waiting out a release delay); any
 * other value a dying object's countdown. Decoded in the ROM by `and a`, `inc a`, `inc a`.
 *
 * LIVE-OUT: memory only.
 */

import { steerTowardAimHeading } from "./steerTowardAimHeading.js";
import { flyAtSlowestSpeed } from "./flyAtSlowestSpeed.js";
import { hasReachedRetireLine } from "./hasReachedRetireLine.js";
import { retireSlotAndSubPixel } from "./retireSlotAndSubPixel.js";
import { fireCraftShotWhenAimedNearPlayer } from "./fireCraftShotWhenAimedNearPlayer.js";
import { dressSpriteForFineHeading } from "./dressSpriteForFineHeading.js";
import { launchAttackerIntoFreeSlot } from "./launchAttackerIntoFreeSlot.js";
import { releaseHeldObject } from "./releaseHeldObject.js";
import { stepDyingObjectState } from "./stepDyingObjectState.js";
import { FRAME_TICK } from "./names.js";

// State-byte values (record +0).
const ACTIVE = 0xff;
const HELD = 0xfe;
// Low two bits of the frame counter: steering runs while they are below 3, i.e. on three of the four tick phases.
const STEER_MASK = 3;

export function serviceEra2EnemyCraftSlot(m, record = m.regs.ix, entry = m.regs.iy) {
  const { mem8 } = m;
  // An empty slot has nothing to do (the ROM's `ret z`).
  const state = mem8[record];
  if (state === 0) return;

  if (state === ACTIVE) {
    // Steering, throttled. FRAME_TICK (0xA980, [seen]) advances once per vblank; the ROM's
    // `and 0x03 / cp 0x03 / call c,0x2BEF` turns the heading one step toward the aim heading
    // (steerTowardAimHeading) on calls where the tick's low two bits are 0-2 and skips it when they read 3, so
    // this era's craft turn more slowly than a craft steered on every call.
    if ((mem8[FRAME_TICK] & STEER_MASK) < STEER_MASK) steerTowardAimHeading(m, record);
    // Move one step at the slowest velocity-table speed (flyAtSlowestSpeed, 0x5840).
    flyAtSlowestSpeed(m, record, entry);
    // Retire test: a craft on either fixed retire line has left play. hasReachedRetireLine (0x2B83)
    // answers with the carry flag and the ROM tail-jumps (`jp c,0x2BDE`) to retireSlotAndSubPixel,
    // which zeroes the slot; nothing else runs for it.
    if (hasReachedRetireLine(m, entry)) return retireSlotAndSubPixel(m, record, entry);
    // Still in play: one gated bank launch when aimed near the player (0x3ED6); dress the sprite to
    // face its heading, resolved to thirty-two sectors (dressSpriteForFineHeading, 0x2A97); then the
    // attacker launch into a free slot on this object's turn (launchAttackerIntoFreeSlot, 0x4243).
    fireCraftShotWhenAimedNearPlayer(m, record, entry);
    dressSpriteForFineHeading(m, entry, record);
    launchAttackerIntoFreeSlot(m, record, entry);
    return;
  }

  // Not active. A held object counts its release delay down and turns active when it expires
  // (releaseHeldObject, 0x2B52); any other value is a death countdown step (stepDyingObjectState,
  // 0x2B93). Both are ROM tail jumps, so their result is returned as this routine's.
  if (state === HELD) return releaseHeldObject(m, record);
  return stepDyingObjectState(m, record, entry);
}

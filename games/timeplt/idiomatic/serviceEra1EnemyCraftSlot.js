// SPDX-License-Identifier: GPL-3.0-only
/**
 * serviceEra1EnemyCraftSlot — one round-engine pass of one enemy-craft slot in era 1 (1940).
 *
 * ROM 0x294C. Grounding: [seen] (names.js ROUTINES 0x294c).
 *
 * WHAT IT IS. Enemy craft live in object slots: a sixteen-byte record whose first
 * byte is the slot's status, paired with a sprite entry. This routine services one such slot for one
 * pass, branching on the status byte:
 *   - 0x00 (empty): nothing to do;
 *   - 0xFE (held): count the hold down and release the craft when it expires (releaseHeldObject);
 *   - any value other than 0xFF: the craft is dying, so step its death sequence (stepDyingObjectState);
 *   - 0xFF (active): fly it -- turn toward its aim heading, fly one step, then either retire the slot
 *     (it has reached the retire line) or give it one gated launch attempt and redraw its sprite from
 *     its heading.
 *
 * ROLE IN THE MACHINE. Index 1 of the per-era slot-service table at 0x2914 (ERA_INDEX & 7 == 1): the
 * era-1 member of the family serviceEra0/2/3/4EnemyCraftSlot, which share the same status ladder. The
 * era-1 specifics are the flight step (paced by the velocity table at 0x5E00, where era 0 uses
 * the 0x59D7 table through 0x5840) and the second era's sprite shapes and tint.
 *
 * PARAMETERS. `record` is the slot's object record, `entry` its sprite entry.
 *
 * LIVE-OUT: memory; on the refreshed path, the accumulator and flags the sprite refresh leaves.
 */

import { steerTowardAimHeading } from "./steerTowardAimHeading.js";
import { loc_5854 } from "./loc_5854.js";
import { hasReachedRetireLine } from "./hasReachedRetireLine.js";
import { retireSlotAndSubPixel } from "./retireSlotAndSubPixel.js";
import { launchBankEnemyWhenAimedNearPlayer } from "./launchBankEnemyWhenAimedNearPlayer.js";
import { refreshSecondEraSpriteFromHeading } from "./refreshSecondEraSpriteFromHeading.js";
import { releaseHeldObject } from "./releaseHeldObject.js";
import { stepDyingObjectState } from "./stepDyingObjectState.js";

// The status-byte values this slot service tells apart (record +0x00).
const EMPTY = 0;
const HELD = 0xfe;
const ACTIVE = 0xff;

export function serviceEra1EnemyCraftSlot(m, record = m.regs.ix, entry = m.regs.iy) {
  // The slot's record and sprite entry are handed to every step that takes them, so a slot named
  // here is the slot every step works on.
  // Status ladder: empty -> nothing; held -> release countdown; any non-active value -> dying.
  const status = m.mem8[record];
  if (status === EMPTY) return;
  if (status === HELD) return releaseHeldObject(m, record);
  if (status !== ACTIVE) return stepDyingObjectState(m, record, entry);

  // Active craft: turn one step toward the aim heading, then fly one step at the 0x5E00
  // velocity-table pace (loc_5854).
  steerTowardAimHeading(m, record);
  loc_5854(m, record, entry);
  // Once it has drifted onto a retire line, take it out of play and free the slot.
  if (hasReachedRetireLine(m, entry)) return retireSlotAndSubPixel(m, record, entry);
  // Otherwise: one gated attempt to launch an enemy into the object bank, then redraw the sprite
  // pointing the way it is heading, in the second era's shape bank.
  launchBankEnemyWhenAimedNearPlayer(m, record, entry);
  return refreshSecondEraSpriteFromHeading(m, record, entry);
}

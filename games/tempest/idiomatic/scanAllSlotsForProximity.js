// SPDX-License-Identifier: GPL-3.0-only
import { SLOT_STATE } from "./names.js";
import { resolveSlotProximityInteractions } from "./resolveSlotProximityInteractions.js";

/**
 * scanAllSlotsForProximity -- drive the proximity pass across the whole live set. ROM 0xa454.
 *
 * Role in the machine: Tempest tracks up to eight active objects in the eight-entry slot table at
 * $2d3 (SLOT_STATE). Each frame the game must let every occupied slot react to how near it now sits
 * to the other objects sharing its web lane -- that is what decides whether an enemy is close enough
 * to be caught, to spawn, or to be torn down. This routine is the outer loop that visits all eight
 * slots and hands each live one to the per-slot proximity resolver.
 *
 * Behavior: walk the slot index x from 7 down to 0. Read the slot's state byte from $2d3,x; a zero
 * entry is a dead/unused slot and is skipped. For every nonzero entry, call
 * resolveSlotProximityInteractions with that entry value as the proximity threshold and x as the slot
 * index, letting it fold that slot against the coordinate set and retire/spawn as its rules dictate.
 *
 * Live-out: nothing of its own -- all state changes ($2d3,x teardown, live count $135, spawns) happen
 * inside resolveSlotProximityInteractions per visited slot.
 *
 * y is the Y the ROM enters with. Returns the exit [X, Y] the ROM leaves: X = 0xff (the walk runs X past 0)
 * and Y = the last resolveSlotProximityInteractions exit Y, or the incoming y when no slot is live.
 * Grounding: [seen].
 */
export function scanAllSlotsForProximity(m, y = m.regs.y) {
  const { mem8 } = m;
  for (let x = 7; x >= 0; x--) {                              // visit all eight slots, high index first
    const entry = mem8[SLOT_STATE + x];                       // this slot's state byte (0 = dead slot)
    if (entry !== 0) y = resolveSlotProximityInteractions(m, entry, x); // live slot: entry is the threshold, x the index
  }
  return [0xff, y];
}

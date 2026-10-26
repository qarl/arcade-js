// SPDX-License-Identifier: GPL-3.0-only
import { rotateBlasterAroundRim } from "./rotateBlasterAroundRim.js";
import { spawnEntityIntoFreeSlot } from "./spawnEntityIntoFreeSlot.js";
import { stepAttractEnemySweepTimer } from "./stepAttractEnemySweepTimer.js";
import { tickSpawnSlotTimers } from "./tickSpawnSlotTimers.js";
import { runObjectMotionScripts } from "./runObjectMotionScripts.js";
import { stepActiveShots } from "./stepActiveShots.js";
import { spawnClimbersFromSourceSlots } from "./spawnClimbersFromSourceSlots.js";
import { scanAllSlotsForProximity } from "./scanAllSlotsForProximity.js";
import { ageTimedObjects } from "./ageTimedObjects.js";
import { ageShotsAndAdvanceFrameClock } from "./ageShotsAndAdvanceFrameClock.js";

/**
 * runPerFrameUpdates — the per-frame gameplay update driver. ROM 0x970b.
 *
 * Role in the machine: this is the top of Tempest's once-per-frame simulation. Every displayed frame it
 * fans out to the nine subsystem passes that advance the live playfield — the player's blaster on the rim,
 * enemy spawning and timers, enemy motion scripts, player shots, climbers, proximity/collision scanning,
 * and object aging — then tail-delegates to the final pass that ages shots and ticks the frame clock. It
 * owns no state of its own; it is pure sequencing, and the fixed order is load-bearing (spawns before
 * motion, motion before shot stepping, aging last).
 *
 * Behavior: calls the nine passes in fixed order and returns the result of the tenth (tail) pass.
 *
 * Register flow: the sound loader stashes the X/Y it is called with (loc_31/loc_32), and the object
 * insert stashes them too (loc_35/loc_36), so passes that reach them are handed the ROM's X/Y. y and x are
 * the Y and X this routine is entered with; rotateBlasterAroundRim returns the Y it leaves, which the spawn
 * pass gets. tickSpawnSlotTimers leaves X = 0xff, which runObjectMotionScripts sees when its walk is
 * skipped; that pass returns its exit Y (the animation sum), the Y stepActiveShots enters with. From there
 * each pass returns its exit [X, Y] and the next is entered with them, and the tail pass's exit [X, Y] is
 * returned as this routine's.
 * Grounding: [seen].
 */
export function runPerFrameUpdates(m, y = m.regs.y, x = m.regs.x) {
  [, y] = rotateBlasterAroundRim(m, y, x); // move the player's blaster around the tube rim
  spawnEntityIntoFreeSlot(m, y);        // seat a newly spawned enemy into a free slot
  stepAttractEnemySweepTimer(m);        // advance the attract-mode enemy sweep timer
  x = tickSpawnSlotTimers(m);           // count down the per-slot spawn timers
  [, y] = runObjectMotionScripts(m, x); // run every occupied slot's motion script
  [x, y] = stepActiveShots(m, y);       // advance active player/enemy shots
  [x, y] = spawnClimbersFromSourceSlots(m, x, y); // spawn climbers up the lanes from source slots
  [x, y] = scanAllSlotsForProximity(m, y); // proximity / collision scan across all slots
  [x, y] = ageTimedObjects(m, y, x);    // age transient timed objects
  return ageShotsAndAdvanceFrameClock(m, x, y); // tail: age shots + tick the frame clock
}

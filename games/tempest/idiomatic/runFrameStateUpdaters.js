// SPDX-License-Identifier: GPL-3.0-only
import { SPIKED_SEGMENT_COUNT, PLAYER_FINE_ANGLE } from "./names.js";
import { rotateBlasterAroundRim } from "./rotateBlasterAroundRim.js";
import { advanceMovingSpike } from "./advanceMovingSpike.js";
import { ageTimedObjects } from "./ageTimedObjects.js";
import { spawnEntityIntoFreeSlot } from "./spawnEntityIntoFreeSlot.js";
import { stepActiveShots } from "./stepActiveShots.js";
import { ageShotsAndAdvanceFrameClock } from "./ageShotsAndAdvanceFrameClock.js";

/**
 * runFrameStateUpdaters -- the per-frame world-update chain. ROM 0x9729.
 *
 * Role in the machine: once per game update this fires the sequence of routines that advance everything
 * that moves on the tube -- the player's rim rotation, the spikes, the timed objects, new spawns, and the
 * active shots -- in a fixed order so each updater sees the results of the ones before it. It is the
 * "tick the world" step of the frame; the caller runs it inside the main loop.
 *
 * Behavior: first clear bit7 of SPIKED_SEGMENT_COUNT ($123), the per-frame flag that shares that tally
 * cell, masking it back to 0..0x7f so this frame starts with a clean count. Then call the five updaters in
 * order: rotateBlasterAroundRim ($9749) turns the spinner/aim into the player's new rim angle;
 * advanceMovingSpike ($97f8) steps the moving spike; ageTimedObjects ($a416) ages timed objects;
 * spawnEntityIntoFreeSlot ($a23f) seats a new enemy into a free slot; stepActiveShots ($a18f) advances
 * live shots. Finally, only when PLAYER_FINE_ANGLE ($201) is negative (bit7 set -- the rotation/
 * object-pending flag), run the extra updater ageShotsAndAdvanceFrameClock ($a504).
 *
 * Live-out: no cell is written directly except the bit7 clear of SPIKED_SEGMENT_COUNT; the frame's real
 * output is the composed state left by the six callees.
 *
 * Register flow: several callees reach the sound loader (loc_31/loc_32 stash X/Y) or the object insert
 * (loc_35/loc_36 stash X/Y), so each is handed the X/Y the ROM holds at that point. y is the Y this
 * routine is entered with; rotateBlasterAroundRim, ageTimedObjects and spawnEntityIntoFreeSlot each
 * return the Y they leave and it is carried to the next pass (advanceMovingSpike leaves Y alone). The
 * spike's X is the rotation's exit X (x is the X this routine is entered with): TUBE_GEOM_FLAG, which the
 * rotation loads for its end-of-rim test whenever the spike can move (both skip on the same
 * PLAYER_FINE_ANGLE bit7, and the rotation clears it). stepActiveShots loads X before any later pass reads
 * it, so the X the passes between leave is not carried. Returns the exit [X, Y] the ROM leaves:
 * stepActiveShots', or the extra updater's when it runs (entered with stepActiveShots').
 * Grounding: [seen].
 */
export function runFrameStateUpdaters(m, y = m.regs.y, x = m.regs.x) {
  const { mem8 } = m;
  mem8[SPIKED_SEGMENT_COUNT] = mem8[SPIKED_SEGMENT_COUNT] & 0x7f; // drop the per-frame bit7, keep the tally
  [x, y] = rotateBlasterAroundRim(m, y, x);   // player rim rotation from spinner/aim
  advanceMovingSpike(m, x, y);                // step the moving spike
  [, y] = ageTimedObjects(m, y);              // age timed objects
  y = spawnEntityIntoFreeSlot(m, y);          // seat a new enemy into a free slot
  [x, y] = stepActiveShots(m, y);             // advance the live shots
  if (mem8[PLAYER_FINE_ANGLE] & 0x80) return ageShotsAndAdvanceFrameClock(m, x, y); // extra pass only when $201 bit7 set
  return [x, y];
}

// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  SLOT_LOOP_INDEX, SCRIPT_WALK_CONTINUE, SCRIPT_CURSOR, ENEMY_SLOT_TOP, LANE_ENEMY_COUNT_1, ENEMY_ANIM_DELTA, ENEMY_ANIM_ACCUM, PLAYER_FINE_ANGLE, ENEMY_SCRIPT_CURSOR, ENEMY_DEPTH, MOTION_SCRIPT_TABLE,
} from "./names.js";
import { dispatchSlotMotionHandler } from "./dispatchSlotMotionHandler.js";
import { cueSpikeCollisionSound } from "./cueSpikeCollisionSound.js";
import { requestMotionFlipSound } from "./requestMotionFlipSound.js";

/**
 * runObjectMotionScripts — the per-frame motion-script walker for every active tube object. ROM 0x9b1e.
 *
 * Role in the machine: each enemy occupying the tube runs a little byte-coded motion program that decides
 * how it crawls, flips, and climbs along its lane. Once per frame this routine drives every occupied slot
 * through its script, then advances the shared animation sweep that makes the whole field pulse and, at its
 * limits, reverses direction — the visible back-and-forth "breathing" of the enemy set.
 *
 * Behavior: the walk runs only when PLAYER_FINE_ANGLE is nonnegative (bit 7 clear); a negative angle means
 * the player field is mid-transition and the whole outer walk is skipped. When it runs, SLOT_LOOP_INDEX is
 * seeded from ENEMY_SLOT_TOP and counted down to 0. For each slot with a nonzero ENEMY_DEPTH (i.e. actually
 * present on the tube) it loads that slot's saved script cursor ENEMY_SCRIPT_CURSOR,x into SCRIPT_CURSOR,
 * raises the continuation flag SCRIPT_WALK_CONTINUE, then loops dispatching the motion opcode found at
 * MOTION_SCRIPT_TABLE[SCRIPT_CURSOR] (slot x passed as an explicit arg) and post-incrementing the cursor,
 * until a handler clears the continuation flag; the advanced cursor is stored back to ENEMY_SCRIPT_CURSOR,x.
 * After the walk it signed-accumulates ENEMY_ANIM_DELTA into ENEMY_ANIM_ACCUM: if that sum crosses a sign
 * boundary it fires the sweep sound cues — cueSpikeCollisionSound when the sum turns negative, else
 * requestMotionFlipSound when lanes are populated (LANE_ENEMY_COUNT_1 nonzero) and the field is settled.
 * Finally, when ENEMY_ANIM_ACCUM leaves the [0x0f, 0xc0] band it negates ENEMY_ANIM_DELTA to reverse the
 * sweep direction.
 *
 * The two tail sound cues are handed the X and Y the ROM holds at those calls, because the sound loader
 * stashes both in loc_31/loc_32. X is reloaded from SLOT_LOOP_INDEX at the top of every walk iteration,
 * occupied slot or not, and the motion handlers hand it back unchanged, so after the walk X = the index
 * of the last iteration (0 unless ENEMY_SLOT_TOP starts negative); with the walk skipped it is the
 * incoming xIn. Y is the accumulated sum itself (the ROM moves it through Y to store it).
 *
 * Live-out: each occupied slot's ENEMY_SCRIPT_CURSOR,x is advanced; ENEMY_ANIM_ACCUM holds the new sweep
 * accumulator and ENEMY_ANIM_DELTA its (possibly negated) step; SCRIPT_CURSOR/SLOT_LOOP_INDEX/SCRIPT_WALK_
 * CONTINUE are left as loop residue; sound cues may have been queued. Returns the exit [X, Y] (X as above,
 * Y = the new ENEMY_ANIM_ACCUM), which the next pass, stepActiveShots, receives as its incoming Y.
 * Grounding: [seen].
 */
export function runObjectMotionScripts(m, xIn = m.regs.x) {
  const { mem8 } = m;
  let lastX = xIn;

  if ((mem8[PLAYER_FINE_ANGLE] & 0x80) === 0) {          // PLAYER_FINE_ANGLE >= 0 (else the outer walk is skipped)
    mem8[SLOT_LOOP_INDEX] = mem8[ENEMY_SLOT_TOP];
    do {
      const x = mem8[SLOT_LOOP_INDEX];
      lastX = x; // every iteration reloads X from the loop index, occupied slot or not
      if (mem8[u16(ENEMY_DEPTH + x)] !== 0) {
        mem8[SCRIPT_WALK_CONTINUE] = 1;
        mem8[SCRIPT_CURSOR] = mem8[u16(ENEMY_SCRIPT_CURSOR + x)];
        do {
          // the slot x rides into the dispatcher's handlers as an explicit arg
          dispatchSlotMotionHandler(m, mem8[u16(MOTION_SCRIPT_TABLE + mem8[SCRIPT_CURSOR])], x); // dispatch on the table entry at the cursor
          mem8[SCRIPT_CURSOR] = u8(mem8[SCRIPT_CURSOR] + 1);
        } while (mem8[SCRIPT_WALK_CONTINUE] !== 0);
        mem8[u16(ENEMY_SCRIPT_CURSOR + x)] = mem8[SCRIPT_CURSOR];
      }
      mem8[SLOT_LOOP_INDEX] = u8(mem8[SLOT_LOOP_INDEX] - 1);
    } while ((mem8[SLOT_LOOP_INDEX] & 0x80) === 0);      // until SLOT_LOOP_INDEX decrements past 0
  }

  // signed accumulate ENEMY_ANIM_DELTA into ENEMY_ANIM_ACCUM
  const old148 = mem8[ENEMY_ANIM_ACCUM];
  const sum = u8(old148 + mem8[ENEMY_ANIM_DELTA]);
  mem8[ENEMY_ANIM_ACCUM] = sum;
  if ((sum ^ old148) & 0x80) {                  // the accumulate crossed a sign boundary
    if (sum & 0x80) {
      cueSpikeCollisionSound(m, lastX, sum); // X = the walk's leftover index, Y = the sum
    } else if (mem8[LANE_ENEMY_COUNT_1] !== 0 && (mem8[PLAYER_FINE_ANGLE] & 0x80) === 0) {
      requestMotionFlipSound(m, lastX, sum);
    }
  }

  // clamp: negate the delta when ENEMY_ANIM_ACCUM sits in the [0x0f, 0xc0] band
  const v = mem8[ENEMY_ANIM_ACCUM];
  const negate = (v & 0x80) === 0 ? v >= 0x0f : v < 0xc1;
  if (negate) mem8[ENEMY_ANIM_DELTA] = u8((mem8[ENEMY_ANIM_DELTA] ^ 0xff) + 1);
  return [lastX, sum]; // the sound loader hands X/Y back unchanged, so these are the exit registers
}

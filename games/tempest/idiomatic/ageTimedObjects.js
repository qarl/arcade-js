// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { TIMED_OBJECT_COUNT, SHAPE_ID, SHAPE_ACTIVE, SHAPE_ANIM, TIMED_OBJ_LIMIT_TABLE, TIMED_OBJ_STEP_TABLE } from "./names.js";

/**
 * ageTimedObjects -- age the timed-object animation table one tick. ROM 0xa416.
 *
 * Role in the machine: Tempest keeps up to 8 short-lived animated objects (the transient
 * shapes -- pulsars/explosions/superzapper flashes and the like) in a slot table. Each frame
 * this routine ticks every live slot's animation counter forward by that object's per-type
 * step; a slot whose counter reaches its per-type limit has finished its animation and is
 * freed. The single pending flag TIMED_OBJECT_COUNT both gates the whole pass (skip it when
 * nothing is animating) and is rebuilt as a live-slot count so the next frame knows whether
 * to run again.
 *
 * Behavior: if TIMED_OBJECT_COUNT is 0 there is nothing pending -- return. Otherwise zero it,
 * then walk slots 7..0. Skip empty slots (SHAPE_ACTIVE+i == 0). For a live slot read its type
 * (SHAPE_ID+i), add the per-type step TIMED_OBJ_STEP_TABLE[type] to its animation counter
 * SHAPE_ANIM+i (8-bit wrap), and compare: still below the per-type limit
 * TIMED_OBJ_LIMIT_TABLE[type] means the object is still animating, so re-raise
 * TIMED_OBJECT_COUNT; at or past the limit the object is done, so free the slot
 * (SHAPE_ACTIVE+i = 0).
 *
 * Live-out: the SHAPE_ANIM counters (advanced), freed SHAPE_ACTIVE slots, and TIMED_OBJECT_COUNT
 * rebuilt as the count of slots still animating (0 => no more work next frame). Returns the exit [X, Y].
 * The ROM indexes the per-type tables through Y, so it leaves Y = the type of the last live slot walked
 * (the lowest-numbered one), or the caller's y untouched when the pass is skipped or no slot is live.
 * runFrameStateUpdaters carries it into the spawn pass, whose sound loader stashes it in loc_32. X is 0xff
 * when the walk ran (it runs X past 0), else the caller's x untouched.
 *
 * Grounding: [seen].
 */
export function ageTimedObjects(m, y, x) {
  const { mem8 } = m;
  if (mem8[TIMED_OBJECT_COUNT] === 0) return [x, y]; // nothing pending this frame
  mem8[TIMED_OBJECT_COUNT] = 0; // rebuilt below as the live-slot count
  for (let i = 7; i >= 0; i--) {
    if (mem8[u16(SHAPE_ACTIVE + i)] === 0) continue; // empty slot
    const type = mem8[u16(SHAPE_ID + i)];
    y = type; // the ROM holds the type in Y
    // Advance this slot's animation counter by its per-type step (8-bit wrap).
    const next = u8(mem8[u16(SHAPE_ANIM + i)] + mem8[u16(TIMED_OBJ_STEP_TABLE + type)]);
    mem8[u16(SHAPE_ANIM + i)] = next;
    if (next < mem8[u16(TIMED_OBJ_LIMIT_TABLE + type)]) {
      mem8[TIMED_OBJECT_COUNT] = u8(mem8[TIMED_OBJECT_COUNT] + 1); // still animating -> re-raise
    } else {
      mem8[u16(SHAPE_ACTIVE + i)] = 0; // reached its limit -> free the slot
    }
  }
  return [0xff, y];
}

// SPDX-License-Identifier: GPL-3.0-only
/**
 * dispatchCollisionPassByEra — pick this frame's collision work by era, then by frame parity.
 *
 * ROM 0x4E4F-0x4E62 (the even-frame arm falls through into 0x4E63). Grounding: [seen]
 * (names.js ROUTINES 0x4e4f).
 *
 * WHAT IT IS. Collision detection (player shots against enemies, enemies against the player) is too
 * much work to do in full every frame on the Z80, so the game spreads it across alternate frames.
 * This is the switch that chooses which slice runs now.
 *
 * ROLE IN THE MACHINE. Reached from the round engine's sub-step 7 dispatcher (ROM 0x1199) once per
 * frame of play. Era 4 (the last, 2001 era) and era 1 (1940) each have their own dispatch tail;
 * every other era splits on the low bit of FRAME_TICK
 * (0xA980): odd frames run the shot sweep, even frames the whole collision-and-destruction pass.
 *
 * LIVE-OUT: memory.
 */

import { dispatchEra4CollisionByFrameParity } from "./dispatchEra4CollisionByFrameParity.js";
import { splitCollisionWorkByFrameParity } from "./splitCollisionWorkByFrameParity.js";
import { dispatchShotSweepByMotherShipArmed } from "./dispatchShotSweepByMotherShipArmed.js";
import { runAllCollisionSweepsThisFrame } from "./runAllCollisionSweepsThisFrame.js";
import { ERA_INDEX, FRAME_TICK } from "./names.js";

export function dispatchCollisionPassByEra(m) {
  const { mem8 } = m;
  // Era first (ERA_INDEX 0xAD04): era 4 tails to 0x4F2A, era 1 to 0x4EBC. Each of those does its
  // own frame-parity split.
  const era = mem8[ERA_INDEX];
  if (era === 4) return dispatchEra4CollisionByFrameParity(m);
  if (era === 1) return splitCollisionWorkByFrameParity(m);
  // Any other era: odd frames sweep the player's shots against targets (0x4F35); even frames run
  // the contact sweeps plus one shot sweep against the era-object slots (0x4E63).
  if (mem8[FRAME_TICK] & 0x01) return dispatchShotSweepByMotherShipArmed(m);
  return runAllCollisionSweepsThisFrame(m);
}

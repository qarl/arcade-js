// SPDX-License-Identifier: GPL-3.0-only
/** dispatchEra4CollisionByFrameParity — the era-4 per-frame collision dispatch, split by frame parity. On even frames run the
 * whole collision-and-destruction pass: the player-contact sweeps plus one shot sweep against the era-object slots. On odd frames stage one shot-versus-
 * target sweep over a run of object slots and hand it the shared destruction body: while the mother
 * ship is armed the run is nine long and a following mother-ship mutual-kill pass runs after it;
 * while it is clear the run is eleven long and no mother-ship pass follows. The two cursor cells the
 * shared body reloads between passes are staged in memory first so every pass restarts on this run.
 * LIVE-OUT: memory.
 *
 * ROM 0x4F2A-0x4F34 plus its interior arm 0x5032-0x507D (frozen lift translated/loc_4f2a.js).
 * Grounding: [seen] in names.js.
 *
 * Role in the machine: reached only as the era-4 tail of dispatchCollisionPassByEra — in the last
 * era (ERA_INDEX 4) collision work is split across two frames instead of being done all at once.
 * FRAME_TICK (0xA980) advances once per frame, so its bit 0 alternates: even frames run the full
 * pass, odd frames run the shot-versus-target sweep below. */

import { runAllCollisionSweepsThisFrame } from "./runAllCollisionSweepsThisFrame.js";
import { destroyTargetsHitByShots } from "./destroyTargetsHitByShots.js";
import { destroyMotherShipAndShotOnMutualHit } from "./destroyMotherShipAndShotOnMutualHit.js";
import { ACTOR_ENTRY_SLOT0, ACTOR_RECORD_SLOT0, FRAME_TICK, MOTHER_SHIP_ARMED, PLAYER_SHOT_ARRAY, SCRATCH_PTR_A, SCRATCH_PTR_B } from "./names.js";

// The sweep's parameters, as the ROM loads them before `call 0x5211`: six player shots (`ld c,0x06`),
// and a hit box of reach 7 and span 0x0F on both axes (`ld l,0x07 / ld h,0x0f`).
const SHOTS = 0x06;
const REACH = 0x07;
const SPAN = 0x0f;
// How many object slots the sweep covers (`ld a,0x09` / `ld a,0x0b` into A' and B).
const ARMED_TARGETS = 0x09;
const OPEN_TARGETS = 0x0b;

export function dispatchEra4CollisionByFrameParity(m) {
  const { mem8, mem16 } = m;
  /* Even frame (0x4F2A-0x4F31): the whole collision-and-destruction pass (0x4E63, a tail jump). */
  if ((mem8[FRAME_TICK] & 0x01) === 0) return runAllCollisionSweepsThisFrame(m);

  /* Odd frame (0x5032): the run length depends on MOTHER_SHIP_ARMED (0xAD0D), which stays raised for
   * the rest of the round or life once the Mother-Ship has been armed. */

  const armed = mem8[MOTHER_SHIP_ARMED] !== 0;
  const targets = armed ? ARMED_TARGETS : OPEN_TARGETS;

  /* Stage the cursor pair the shared sweep body reloads between passes: SCRATCH_PTR_B (0xA993) gets
   * the first record, ACTOR_RECORD_SLOT0 (0xA810), and SCRATCH_PTR_A (0xA991) its sprite entry,
   * ACTOR_ENTRY_SLOT0 (0xAA12), so every pass restarts at the head of this run. */
  mem16[SCRATCH_PTR_B] = ACTOR_RECORD_SLOT0;
  mem16[SCRATCH_PTR_A] = ACTOR_ENTRY_SLOT0;

  /* destroyTargetsHitByShots (0x5211) tests each live shot of PLAYER_SHOT_ARRAY (0xAA80) against
   * each target in the run, destroying and scoring every hit. Armed: the sweep is a real call, and
   * the mother-ship mutual-kill pass (0x4FE0) follows as a tail jump. Clear: the sweep is the tail. */
  if (armed) {
    destroyTargetsHitByShots(
      m, PLAYER_SHOT_ARRAY, ACTOR_ENTRY_SLOT0, ACTOR_RECORD_SLOT0,
      targets, targets, SHOTS, REACH, SPAN,
    );
    return destroyMotherShipAndShotOnMutualHit(m);
  }
  return destroyTargetsHitByShots(
    m, PLAYER_SHOT_ARRAY, ACTOR_ENTRY_SLOT0, ACTOR_RECORD_SLOT0,
    targets, targets, SHOTS, REACH, SPAN,
  );
}

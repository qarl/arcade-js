// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  STATUS_FLAGS, loc_29, INPUT_DEBOUNCED, SPIKE_ACTIVE_FLAG, ACTIVE_OBJECT_COUNT,
  PLAYER_SEGMENT, PLAYER_FINE_ANGLE, PLAYER_SHOT_DEPTH, TARGET_SEG, loc_2b5, loc_2c0, SLOT_STATE, loc_2db, HIT_TALLY,
} from "./names.js";
import { requestEnemySpawnSound } from "./requestEnemySpawnSound.js";
import { resolveSlotProximityInteractions } from "./resolveSlotProximityInteractions.js";

/**
 * spawnEntityIntoFreeSlot — conditionally spawn an entity at the player's position. ROM 0xa23f.
 *
 * Role in the machine: this decides whether to drop a new entity (an enemy/shot object seeded at the
 * player's current tube position) and, if so, seats it in a free object slot. The go/no-go decision is
 * a "gate": in one mode it is a debounced input bit, in the other it is a crowding count of how many
 * flyers already sit near the player's segment plus a spike-active bias. Only when the gate is nonzero
 * does it allocate a slot, copy the player's depth/segment/angle into it, and fire the spawn sound and
 * proximity-interaction helpers.
 *
 * Behavior: bails immediately if PLAYER_FINE_ANGLE (loc_201) bit7 is set (player not spawnable). It then
 * forms the gate. If STATUS_FLAGS (loc_5) is negative, the gate is simply INPUT_DEBOUNCED & 0x10
 * (loc_4d, a fire/hold bit). Otherwise it seeds loc_29 from SPIKE_ACTIVE_FLAG (loc_106) and, for each
 * flyer slot x = 10..0 that is occupied (loc_2db,x nonzero), takes the absolute segment distance between
 * that flyer's segment loc_2b5,x and PLAYER_SEGMENT (loc_200); every flyer within 1 segment increments
 * loc_29. The resulting loc_29 is the gate. A zero gate bails (nothing to spawn against). Otherwise it
 * scans the object slot table SLOT_STATE (loc_2d3, x = 7..0) for the first free (zero) entry, bumps the
 * live-object count ACTIVE_OBJECT_COUNT (loc_135), and seeds that slot: state = PLAYER_SHOT_DEPTH
 * (loc_202), TARGET_SEG = PLAYER_SEGMENT (loc_200), loc_2c0 = PLAYER_FINE_ANGLE (loc_201), HIT_TALLY = 0.
 * It then calls requestEnemySpawnSound and resolveSlotProximityInteractions for that slot and stops —
 * only the first free slot is filled.
 *
 * Live-out: on a spawn, the seeded slot across SLOT_STATE/TARGET_SEG/loc_2c0/HIT_TALLY, the bumped
 * ACTIVE_OBJECT_COUNT, and the queued spawn sound / proximity resolution; loc_29 holds the computed
 * gate count. Y is threaded through: the spawn sound's loader stashes it in loc_32, so the sound gets the
 * caller's incoming y, and the routine returns the exit Y the ROM leaves -- 0xff after a spawn (the
 * proximity scan's leftover), else y untouched. Grounding: [seen].
 */
export function spawnEntityIntoFreeSlot(m, y = m.regs.y) {
  const { mem8 } = m;

  if (mem8[PLAYER_FINE_ANGLE] & 0x80) return y; // player not spawnable

  let gate;
  if (mem8[STATUS_FLAGS] & 0x80) {
    gate = mem8[INPUT_DEBOUNCED] & 0x10; // input-driven gate (fire/hold bit)
  } else {
    // Crowding gate: spike bias plus one per flyer sitting within 1 segment of the player.
    mem8[loc_29] = mem8[SPIKE_ACTIVE_FLAG];
    for (let x = 10; x >= 0; x--) {
      if (mem8[u16(loc_2db + x)] === 0) continue; // skip empty flyer slots
      let delta = u8(mem8[u16(loc_2b5 + x)] - mem8[PLAYER_SEGMENT]);
      if (delta & 0x80) delta = u8((delta ^ 0xff) + 1); // abs of the signed difference
      if (delta < 2) mem8[loc_29] = u8(mem8[loc_29] + 1); // within one segment -> count it
    }
    gate = mem8[loc_29];
  }

  if (gate === 0) return y; // gate closed -> no spawn

  for (let x = 7; x >= 0; x--) {
    if (mem8[u16(SLOT_STATE + x)] !== 0) continue; // occupied slot
    mem8[ACTIVE_OBJECT_COUNT] = u8(mem8[ACTIVE_OBJECT_COUNT] + 1); // one more live object
    mem8[u16(SLOT_STATE + x)] = mem8[PLAYER_SHOT_DEPTH]; // seed depth from the player
    mem8[u16(TARGET_SEG + x)] = mem8[PLAYER_SEGMENT];    // seed segment from the player
    mem8[u16(loc_2c0 + x)] = mem8[PLAYER_FINE_ANGLE];    // seed fine angle from the player
    mem8[u16(HIT_TALLY + x)] = 0;
    // The sound loader stashes X/Y into loc_31/loc_32: X is this slot, Y the caller's untouched y.
    requestEnemySpawnSound(m, x, y);
    return resolveSlotProximityInteractions(m, mem8[PLAYER_SHOT_DEPTH], x); // only the first free slot is filled
  }
  return y;
}

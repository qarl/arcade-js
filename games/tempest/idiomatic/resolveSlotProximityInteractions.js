// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import {
  loc_2e, SLOT_LOOP_INDEX, TABLE_CURSOR, HIT_DISTANCE_THRESHOLD,
  ACTIVE_OBJECT_COUNT, ENEMY_BAND_THRESHOLD_0, PLAYER_SHOT_DEPTH, OBJECT_BAND, TARGET_SEG, loc_2b5, loc_2c0, loc_2c8, SLOT_STATE, loc_2db, HIT_TALLY,
} from "./names.js";
import { retireSpawnedObject } from "./retireSpawnedObject.js";
import { spawnLaneEnemyAndAward } from "./spawnLaneEnemyAndAward.js";
import { activateSlotAndRespawn } from "./activateSlotAndRespawn.js";

/**
 * resolveSlotProximityInteractions -- resolve one active slot's collisions against every enemy slot. ROM 0xa463.
 *
 * Role in the machine: when a shot or object (slot X, at depth threshold A) is live on the tube, this
 * routine decides what it hits. It walks all eleven enemy slots (y = 10..0), and for any that sit close
 * enough in depth AND share the slot's segment it either kills the enemy outright (near the player rim)
 * or, deeper in the tube, dispatches a spawn/award or a re-activation. This is the core hit-resolution
 * pass driven by scanAllSlotsForProximity (0xa454).
 *
 * Behavior: park the threshold A in $2e (loc_2e) and scan $2db (loc_2db) for y = 10..0. Skip empty slots.
 * Form delta = |entry - threshold| (absolute depth distance). Near slots (y < 4, close to the rim): skip
 * unless delta < the fixed HIT_DISTANCE_THRESHOLD ($a7) AND the enemy's segment $2b5,y matches this slot's
 * target segment TARGET_SEG,x -- on a match retire the object via retireSpawnedObject. Far slots (y >= 4):
 * record the cursor y in TABLE_CURSOR, fold OBJECT_BAND,y ($27f,y) to a 3-bit band, and skip unless delta is
 * under the per-band threshold ENEMY_BAND_THRESHOLD_0+band ($151,band). Band 4 has its own guard chain
 * (depth vs PLAYER_SHOT_DEPTH, segment match, and the $2c8,y high bit) before spawnLaneEnemyAndAward. Other
 * bands compute a doCall from the $2c8,y armed bit, PLAYER_SHOT_DEPTH, and a loc_2c0/TARGET_SEG segment match;
 * when set, stash X in SLOT_LOOP_INDEX and hand off to activateSlotAndRespawn. After the scan, if this slot's
 * HIT_TALLY entry ($2f2,x) reads 0xff the slot is spent: clear SLOT_STATE,x and HIT_TALLY,x and drop the live
 * count ACTIVE_OBJECT_COUNT ($135).
 *
 * Live-out: enemy slots may be retired/spawned/reactivated via the three helpers; on a spent slot, $2d3,x
 * ($2f2,x) and $135 are cleared/decremented. TABLE_CURSOR / SLOT_LOOP_INDEX / $2e hold scan scratch.
 * Returns the exit Y, 0xff (the scan counts Y down past 0), which callers carry on as their own Y.
 * Grounding: seen.
 */
export function resolveSlotProximityInteractions(m, a = m.regs.a, x = m.regs.x) {
  const { mem8 } = m;

  const threshold = a;
  mem8[loc_2e] = threshold; // park the query depth for the scan

  for (let y = 10; y >= 0; y--) {
    const entry = mem8[u16(loc_2db + y)]; // enemy slot y's depth
    if (entry === 0) continue;            // empty slot
    const delta = entry >= threshold ? entry - threshold : threshold - entry; // |depth distance|

    if (y < 4) {
      // Near the player rim: only a close, same-segment enemy is a kill.
      if (delta >= mem8[HIT_DISTANCE_THRESHOLD]) continue;
      if (mem8[u16(loc_2b5 + y)] !== mem8[u16(TARGET_SEG + x)]) continue;
      retireSpawnedObject(m, x, y);
      continue;
    }

    // Far slot: fold to a 3-bit band and test delta against the per-band threshold.
    mem8[TABLE_CURSOR] = y;
    const band = mem8[u16(OBJECT_BAND + y)] & 0x07;
    if (delta >= mem8[u16(ENEMY_BAND_THRESHOLD_0 + band)]) continue;

    if (band === 4) {
      // Band 4 handler: guard on depth, segment, and the armed high bit before spawning + awarding.
      if (mem8[u16(loc_2db + y)] === mem8[PLAYER_SHOT_DEPTH]) continue;
      if (mem8[u16(TARGET_SEG + x)] !== mem8[u16(loc_2b5 + y)]) continue;
      if ((mem8[u16(loc_2c8 + y)] & 0x80) === 0) continue;
      spawnLaneEnemyAndAward(m, x, y);
      continue;
    }

    // Other bands: decide whether to re-activate the slot from the armed bit / depth / segment match.
    let doCall;
    if ((mem8[u16(loc_2c8 + y)] & 0x80) !== 0) {
      doCall = mem8[u16(loc_2b5 + y)] === mem8[u16(loc_2c0 + x)]
        ? true
        : mem8[u16(loc_2b5 + y)] === mem8[u16(TARGET_SEG + x)];
    } else if (mem8[u16(loc_2db + y)] === mem8[PLAYER_SHOT_DEPTH]) {
      doCall = false;
    } else {
      doCall = mem8[u16(loc_2b5 + y)] === mem8[u16(TARGET_SEG + x)];
    }
    if (doCall) {
      mem8[SLOT_LOOP_INDEX] = x;
      activateSlotAndRespawn(m, x, y);
    }
  }

  // Slot spent (a helper flagged $2f2,x=0xff): tear it down and drop the live object count.
  if (mem8[u16(HIT_TALLY + x)] === 0xff) {
    mem8[u16(SLOT_STATE + x)] = 0;
    mem8[ACTIVE_OBJECT_COUNT] = mem8[ACTIVE_OBJECT_COUNT] - 1;
    mem8[u16(HIT_TALLY + x)] = 0;
  }
  return 0xff; // the exit Y: the descending lane scan runs Y past 0
}

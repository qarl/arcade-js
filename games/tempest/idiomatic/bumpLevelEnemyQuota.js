// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { GAME_MODE, loc_3d, PLAYER_LEVEL_TBL, loc_9f, loc_102 } from "./names.js";
import { seatInPagePointer } from "./seatInPagePointer.js";
import { addBcdScoreAndAwardAtThreshold } from "./addBcdScoreAndAwardAtThreshold.js";
import { requestScoreAwardSound } from "./requestScoreAwardSound.js";
import { runWaveInit } from "./runWaveInit.js";

/**
 * bumpLevelEnemyQuota — ramp the per-level enemy quota, then start the wave. ROM 0xc98c.
 *
 * Role in the machine: as the player clears waves, Tempest slowly raises how many enemies a level
 * spawns. This routine bumps that quota for the current level, flips the game into the wave-active
 * mode, optionally runs a score-award chain, and tail-delegates into the wave initializer.
 *
 * Behavior: it reads the current level index loc_3d and forms the PLAYER_LEVEL_TBL slot for it. While
 * that slot's quota is below the 0x62 cap it increments both the slot and the working copy loc_9f
 * together (they track in lockstep). It then seeds GAME_MODE=0x18 (wave active). If the parallel
 * loc_102 slot for this level is nonzero it uses that value as a trigger: seat it as an in-page pointer
 * (seatInPagePointer), add it to the BCD score awarding at the 0xff threshold, and request the
 * score-award sound. Finally it tail-delegates to runWaveInit to bring the wave up.
 *
 * Live-out: the bumped PLAYER_LEVEL_TBL slot and loc_9f, GAME_MODE=0x18, any score/sound side effects
 * from the trigger chain, and whatever runWaveInit leaves. The award sound's loader stashes the X/Y it
 * is called with (loc_31/loc_32); in the ROM those are what the score add left, so its returned exit
 * registers are handed on (Y is undefined only when scoring is unarmed, and then the sound gate drops the
 * cue before the loader runs). Returns the exit [X, Y] the ROM leaves, runWaveInit's. Grounding: [seen].
 */
export function bumpLevelEnemyQuota(m) {
  const { mem8 } = m;

  const idx = mem8[loc_3d];                     // current level index
  const slot = (PLAYER_LEVEL_TBL + idx) & 0xff; // this level's quota cell (zero-page)
  const cur = mem8[slot];
  if (cur < 0x62) {                             // below the quota cap
    mem8[slot] = cur + 1;                       // bump the level's quota
    mem8[loc_9f] = mem8[loc_9f] + 1;            // and the working copy in lockstep
  }

  mem8[GAME_MODE] = 0x18;                       // enter wave-active mode

  const trigger = mem8[u16(loc_102 + idx)];     // parallel per-level trigger slot
  if (trigger !== 0) {
    seatInPagePointer(m, trigger);              // seat it as an in-page pointer
    const [x, y] = addBcdScoreAndAwardAtThreshold(m, 0xff); // award score at the 0xff threshold
    requestScoreAwardSound(m, x, y);            // cue the award sound with the X/Y the score add leaves
  }

  return runWaveInit(m);                        // tail-delegate to the wave initializer
}

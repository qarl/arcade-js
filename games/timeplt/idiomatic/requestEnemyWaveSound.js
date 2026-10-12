// SPDX-License-Identifier: GPL-3.0-only
/** requestEnemyWaveSound — request one particular sound, and only while a game is in progress. Its code is
 * fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x5817-0x581C (frozen lift loc_5817). Grounding: [seen] (names.js ROUTINES 0x5817).
 *
 * Role in the machine: the sound of an enemy wave. Its one caller, driveEnemyWaveForLifePhase,
 * jumps to it on two conditional exits after the wave's claim timer is re-armed (ROM 0x3784,
 * 0x378F); its third exit, at 0x3792, returns with no sound.
 *
 * The code is ENEMY_WAVE_SOUND (0x273A), a byte of the program ROM read as data (0x0B on a
 * genuine image). It goes through enqueueSoundIfGameInProgress, so it is queued only while
 * PLAY_ACTIVE is set; the frame service later sends it to the audio board.
 */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { ENEMY_WAVE_SOUND } from "./names.js";

export function requestEnemyWaveSound(m) {
  /* ld a,(0x273a) / jp 0x560c: fetch the code and tail-jump into the in-play gate, whose return
   * goes straight back to our caller. */
  enqueueSoundIfGameInProgress(m, m.mem8[ENEMY_WAVE_SOUND]);
}

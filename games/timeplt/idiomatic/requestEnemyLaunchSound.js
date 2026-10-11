// SPDX-License-Identifier: GPL-3.0-only
/** requestEnemyLaunchSound — request one particular sound, and only while a game is in progress. Its code is
 * fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x565F-0x5663 (frozen lift loc_565f). Grounding: [seen] (names.js ROUTINES 0x565F).
 *
 * Role in the machine: the sound of an enemy shot being fired. Its callers are
 * fireBomberShotWhenClearOfPlayer, loc_43f0, and requestEraKeyedLaunchSound — the
 * last picks this code in the first three eras (ERA_INDEX 0-2) and its sibling
 * requestEnemyLaunchSoundLateEra from the fourth era on (ERA_INDEX 3 and 4).
 *
 * The code is ENEMY_LAUNCH_SOUND (0x07A2), a byte of the program ROM read as data, not an
 * immediate operand. It goes through enqueueSoundIfGameInProgress, so it is queued only while
 * PLAY_ACTIVE is set — the attract demo's enemy shots are silent.
 */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { ENEMY_LAUNCH_SOUND } from "./names.js";

export function requestEnemyLaunchSound(m) {
  /* ld a,(0x07a2) / jr 0x560c: fetch the code and jump (nothing pushed) into the in-play gate,
   * whose return goes straight back to our caller. */
  enqueueSoundIfGameInProgress(m, m.mem8[ENEMY_LAUNCH_SOUND]);
}

// SPDX-License-Identifier: GPL-3.0-only
/** requestHighScoreFiledSound — request one particular sound, and only while a game is in progress. Its code is
 * fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x583A-0x583F (frozen lift loc_583a). Grounding: [seen] (names.js ROUTINES 0x583A).
 *
 * Role in the machine: the sound that marks a score entering the high-score table. Its one
 * caller, fileScoreAfterGameOverHoldElsePassTurn, calls it only on the path where
 * fileScoreIntoHighScoreTable did file the finished score, just before the pen is set to colour 0
 * to erase its route and initials entry begins; a score that beats no record never reaches it.
 *
 * The code is the program byte at 0x18FA (HIGH_SCORE_FILED_SOUND_CODE in names.js), read as
 * data, not an immediate operand. It goes through enqueueSoundIfGameInProgress, so it is queued
 * only while PLAY_ACTIVE is set. names.js notes that whether that flag is still set at this
 * point after game over has not been checked under MAME.
 */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { HIGH_SCORE_FILED_SOUND_CODE } from "./names.js";

export function requestHighScoreFiledSound(m) {
  /* ld a,(0x18fa) / jp 0x560c: fetch the code and tail-jump into the in-play gate, whose return
   * goes straight back to our caller. */
  enqueueSoundIfGameInProgress(m, m.mem8[HIGH_SCORE_FILED_SOUND_CODE]);
}

// SPDX-License-Identifier: GPL-3.0-only
/** requestBonusLifeSound — request one particular sound, and only while a game is in progress. Its code is
 * fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x5805-0x580A (frozen lift loc_5805). Grounding: [seen] (names.js ROUTINES 0x5805).
 *
 * Role in the machine: the extra-life fanfare. Its one caller, awardBonusLifeAtScoreMark, runs once
 * per pass of the round engine; when the active player's score matches a bonus mark it increments
 * LIVES_REMAINING, posts ring command 5 to repaint the reserve emblems, and then tail-jumps here.
 *
 * The code is BONUS_LIFE_SOUND (0x2D4E), a byte of the program ROM read as data, not an immediate
 * operand. It goes through enqueueSoundIfGameInProgress, so it is queued only while PLAY_ACTIVE is
 * set; the frame service later sends it to the audio board, one queued code per run.
 */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { BONUS_LIFE_SOUND } from "./names.js";

export function requestBonusLifeSound(m) {
  /* ld a,(0x2d4e) / jp 0x560c: fetch the code and tail-jump into the in-play gate, whose return
   * goes straight back to our caller. */
  enqueueSoundIfGameInProgress(m, m.mem8[BONUS_LIFE_SOUND]);
}

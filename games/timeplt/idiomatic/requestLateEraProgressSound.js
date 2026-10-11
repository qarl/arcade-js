// SPDX-License-Identifier: GPL-3.0-only
/** requestLateEraProgressSound — request one particular sound, and only while a game is in progress. Its code is
 * fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x5679-0x567D (frozen lift loc_5679). Grounding: [seen] (names.js ROUTINES 0x5679).
 *
 * Role in the machine: a sound asked for only in the later eras. Both callers test ERA_INDEX
 * first: askForSoundWhileTheGroupIsClear (which also waits on the frame tick and on a group of
 * era-object slots being clear) and advancePlayerAnimationStrip (on the opening frame of the
 * strip). mechanisms.md records that which sound this is, heard at the latter site, is not yet
 * identified.
 *
 * The code is LATE_ERA_PROGRESS_SOUND (0x07FE), a byte of the program ROM read as data (0x86 on a
 * genuine image). It goes through enqueueSoundIfGameInProgress, so it is queued only while
 * PLAY_ACTIVE is set.
 */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { LATE_ERA_PROGRESS_SOUND } from "./names.js";

export function requestLateEraProgressSound(m) {
  /* ld a,(0x07fe) / jr 0x560c: fetch the code and jump (nothing pushed) into the in-play gate,
   * whose return goes straight back to our caller. */
  enqueueSoundIfGameInProgress(m, m.mem8[LATE_ERA_PROGRESS_SOUND]);
}

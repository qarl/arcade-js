// SPDX-License-Identifier: GPL-3.0-only
/** requestSoundSixStopWhilePlaying — ask the audio processor to stop sound 6, and only while a game is in progress. The stop
 * code is fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x5679-0x567D (frozen lift loc_5679). Grounding: [seen] (names.js ROUTINES 0x5679).
 *
 * Role in the machine: a sound stop asked for only from the third era on. Both callers test
 * ERA_INDEX first: askForSoundWhileTheGroupIsClear (which also waits on the frame tick and on a group of
 * era-object slots being clear) and advancePlayerAnimationStrip (on the opening frame of the
 * strip).
 *
 * The code is LATE_ERA_SOUND_6_STOP_CODE (0x07FE), a byte of the program ROM read as data (0x86 on a
 * genuine image). Bit 7 makes it a stop, not a start: the audio processor's command handler sends a
 * bit-7 code to its stop arm, which finds the channel slot holding the low seven bits, 0x06, and clears
 * it, so a sound 6 still playing is cut off. Sound 0x06 is also the first of the two codes
 * requestTwoSoundsWhilePlaying starts (ROM 0x07D8). It goes through enqueueSoundIfGameInProgress, so it is queued only while
 * PLAY_ACTIVE is set.
 */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { LATE_ERA_SOUND_6_STOP_CODE } from "./names.js";

export function requestSoundSixStopWhilePlaying(m) {
  /* ld a,(0x07fe) / jr 0x560c: fetch the code and jump (nothing pushed) into the in-play gate,
   * whose return goes straight back to our caller. */
  enqueueSoundIfGameInProgress(m, m.mem8[LATE_ERA_SOUND_6_STOP_CODE]);
}

// SPDX-License-Identifier: GPL-3.0-only
/** requestOneShotCountdownSound — request one particular sound, and only while a game is in progress. Its code is
 * not an immediate: it is fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x568E-0x5693 (frozen lift loc_568e). Grounding: [seen] (names.js ROUTINES 0x568E).
 *
 * Role in the machine: its one caller is clampOneShotCountdownThenRequestSound, which stamps an
 * object's state byte to 0x3B — the onset of its animate-out countdown — and then asks for this
 * sound. It is named by that state rather than as a "death" sound because the stamp's callers
 * include non-combat objects (names.js, ONE_SHOT_COUNTDOWN_SOUND).
 *
 * The code is ONE_SHOT_COUNTDOWN_SOUND (0x2D87) [seen], a byte of the program ROM read as data. It
 * goes through enqueueSoundIfGameInProgress, so it is queued only while PLAY_ACTIVE is set.
 */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { ONE_SHOT_COUNTDOWN_SOUND } from "./names.js";

export function requestOneShotCountdownSound(m) {
  /* ld a,(0x2d87) / jp 0x560c: fetch the code and tail-jump into the in-play gate, whose return
   * goes straight back to our caller. */
  enqueueSoundIfGameInProgress(m, m.mem8[ONE_SHOT_COUNTDOWN_SOUND]);
}

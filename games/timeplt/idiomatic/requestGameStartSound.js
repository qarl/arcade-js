// SPDX-License-Identifier: GPL-3.0-only
/** requestGameStartSound — request one particular sound, and only while a game is in progress. Its code is
 * fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x5834-0x5839 (`ld a,(0x1767)` then `jp 0x560c`). Grounding: [seen].
 *
 * Role in the machine: one of the one-line "sound request" entries the game logic calls when
 * something audible happens -- here, the start of a new game. It plays nothing itself: it hands a
 * sound-command code to the shared sound queue, which the main CPU later drains to the
 * sound-data latch for the second (audio) Z80.
 *
 * LIVE-OUT: memory only -- the sound queue, and only during real play. */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { GAME_START_SOUND } from "./names.js";

export function requestGameStartSound(m) {
  // The code is read from the program byte at 0x1767 (GAME_START_SOUND) rather than written
  // into the instruction, then the ROM tail-jumps to the play-only door at 0x560C
  // (enqueueSoundIfGameInProgress). That door queues the code only while a game is being
  // played; in the attract demo (play flag clear) the request is dropped and not deferred.
  enqueueSoundIfGameInProgress(m, m.mem8[GAME_START_SOUND]);
}

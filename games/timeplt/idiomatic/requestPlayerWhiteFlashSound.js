// SPDX-License-Identifier: GPL-3.0-only
/** requestPlayerWhiteFlashSound — request one particular sound, and only while a game is in progress. Its code is
 * fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x5811-0x5816 (`ld a,(0x07a9)` then `jp 0x560c`). Grounding: [seen].
 *
 * Role in the machine: one of the one-line "sound request" entries the game logic calls when
 * something audible happens -- here, the flash as the player's plane spawns. It plays nothing
 * itself: it hands a sound-command code to the shared sound queue, which the main CPU later
 * drains to the sound-data latch for the second (audio) Z80.
 *
 * LIVE-OUT: memory only -- the sound queue, and only during real play. */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { ROUND_WON_FLASH_SOUND } from "./names.js";

export function requestPlayerWhiteFlashSound(m) {
  // The code is read from the program byte at 0x07A9 (ROUND_WON_FLASH_SOUND) rather than
  // written into the instruction, then the ROM tail-jumps to the play-only door at 0x560C
  // (enqueueSoundIfGameInProgress). That door queues the code only while a game is being
  // played; with the play flag clear -- the attract demo -- the request is dropped outright and
  // nothing is left behind for a later frame, so the demo runs this sound silently.
  enqueueSoundIfGameInProgress(m, m.mem8[ROUND_WON_FLASH_SOUND]);
}

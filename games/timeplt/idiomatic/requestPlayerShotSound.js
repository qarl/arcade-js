// SPDX-License-Identifier: GPL-3.0-only
/** requestPlayerShotSound — request one sound, admitted while a game runs or the cabinet may sound in attract.
 * Its code is fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x567E-0x5682 (`ld a,(0x3270)` then `jr 0x5617`). Grounding: [seen].
 *
 * Role in the machine: one of the many one-line "sound request" entries the game logic calls
 * when something audible happens -- here, the player's shot. It does not play anything itself:
 * it hands a sound-command code to the shared sound queue, which the main CPU later drains to
 * the sound-data latch for the second (audio) Z80 to act on.
 *
 * LIVE-OUT: memory only -- the sound queue (its count and the slot the new count selects), and
 * only when the permission lets the request through. */

import { enqueueSoundIfGameOrDemoSoundsOn } from "./enqueueSoundIfGameOrDemoSoundsOn.js";
import { PLAYER_SHOT_SOUND } from "./names.js";

export function requestPlayerShotSound(m) {
  // The code is not an immediate operand: the ROM reads it from the program byte at 0x3270
  // (PLAYER_SHOT_SOUND), so the value that byte holds IS the command sent. It then tail-jumps
  // into the play-or-demo door at 0x5617 (enqueueSoundIfGameOrDemoSoundsOn), which queues the code
  // while a game is being played or the demo-sounds cell 0xA9C6 is set, and drops it only when
  // both are clear -- so this sound can also be heard during the attract demo.
  enqueueSoundIfGameOrDemoSoundsOn(m, m.mem8[PLAYER_SHOT_SOUND]);
}

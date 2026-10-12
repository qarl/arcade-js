// SPDX-License-Identifier: GPL-3.0-only
/** requestMotherShipAwardSound — request one particular sound, and only while a game is in progress. Its code is
 * fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x580B-0x5810 (frozen lift loc_580b). Grounding: [seen] (names.js ROUTINES 0x580B).
 *
 * Role in the machine: the sound for the Mother-Ship wreck's 3,000-point award. Its one call in the image is `call z,0x580b` at 0x463A, in
 * loc_43f0's flash step for the dying Mother-Ship (head 0xB4, `jr z,0x4623` at 0x45E2; mechanisms.md
 * places the request at that flash step), made only when PLAYER_STATE reads 0xFF, i.e. the player
 * is alive. checkTamperGlyphCopyElseRunAwardLabelStep reaches that same call only on its tamper arm, by
 * falling into 0x4623.
 *
 * The code is MOTHER_SHIP_AWARD_SOUND (0x49EE), a byte of the program ROM read as data, not an
 * immediate operand. It goes through enqueueSoundIfGameInProgress, so it is queued only while
 * PLAY_ACTIVE is set.
 */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { MOTHER_SHIP_AWARD_SOUND } from "./names.js";

export function requestMotherShipAwardSound(m) {
  /* ld a,(0x49ee) / jp 0x560c: fetch the code and tail-jump into the in-play gate, whose return
   * goes straight back to our caller. */
  enqueueSoundIfGameInProgress(m, m.mem8[MOTHER_SHIP_AWARD_SOUND]);
}

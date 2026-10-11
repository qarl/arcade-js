// SPDX-License-Identifier: GPL-3.0-only
/** requestDestructionSoundBurst — ask for a burst of sounds in one go. Three codes are fetched from bytes of the
 * program image and offered one after another to the in-play permission test, so all three are
 * dropped together whenever a game is not running; the entry then runs straight on into a further
 * pair of requests, which decide for themselves whether they may be heard. Nothing arrives from
 * the caller: the choice of codes is the whole content here. LIVE-OUT: memory.
 *
 * ROM 0x56D2-0x56E3, falling through into 0x56E4. Grounding: [seen] (names.js ROUTINES 0x56d2).
 *
 * ROLE IN THE MACHINE. The sound of a destruction: called by advancePlayerAnimationStrip on the
 * opening frame of the player's explosion and by loc_43f0 as the Mother-Ship's death sweep opens; the
 * codes it reads are 0x15, 0x14 and 0x13. The looser-permission tail (requestInterRoundSoundPair) also
 * admits requests while the cell at 0xA9C6 is set, so a state that drops the first three can still
 * let the last two through.
 */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { requestInterRoundSoundPair } from "./requestInterRoundSoundPair.js";
import { DESTRUCTION_SOUND_1, DESTRUCTION_SOUND_2, DESTRUCTION_SOUND_3 } from "./names.js";

export function requestDestructionSoundBurst(m) {
  const { mem8 } = m;
  // The three codes are read out of the program image (ROM 0x0C5B, 0x0855, 0x1675, in that
  // order), not carried as immediates; each goes to the door that queues it only during play.
  enqueueSoundIfGameInProgress(m, mem8[DESTRUCTION_SOUND_1]);
  enqueueSoundIfGameInProgress(m, mem8[DESTRUCTION_SOUND_2]);
  enqueueSoundIfGameInProgress(m, mem8[DESTRUCTION_SOUND_3]);
  // The ROM has no return here: it runs on into 0x56E4, the two-code request (bytes 0x27CB, 0x33A0).
  requestInterRoundSoundPair(m);
}

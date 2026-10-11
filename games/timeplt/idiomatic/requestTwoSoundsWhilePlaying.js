// SPDX-License-Identifier: GPL-3.0-only
/** requestTwoSoundsWhilePlaying — ask for two sounds in a row. This entry supplies the first code, fetched from a byte of the program
 * image rather than carried as an immediate, and leaves through the entry that supplies the second; both go in under
 * the same permission, so a state that refuses one drops the pair together. LIVE-OUT: memory.
 *
 * ROM 0x566E-0x5673, running on into 0x5674. Grounding: [seen] (names.js ROUTINES 0x566e).
 *
 * ROLE IN THE MACHINE. Its caller is commissionStagedAttackerByEra. The permission is
 * enqueueSoundIfGameInProgress, which drops a request while no game is being played; its
 * structural twin requestTwoSounds differs, apart from the two program bytes it reads (0x07A6, 0x4CDA),
 * only in using the door that also admits the demo.
 */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { requestAttackerSpawnSoundLateEra } from "./requestAttackerSpawnSoundLateEra.js";
import { ATTACKER_SPAWN_SOUND_MID_ERA_1 } from "./names.js";

export function requestTwoSoundsWhilePlaying(m) {
  // First code: the program byte at 0x07D8, queued only while a game is in progress.
  enqueueSoundIfGameInProgress(m, m.mem8[ATTACKER_SPAWN_SOUND_MID_ERA_1]);
  // Second code: the entry at 0x5674 reads the byte at 0x276B through the same door.
  requestAttackerSpawnSoundLateEra(m);
}

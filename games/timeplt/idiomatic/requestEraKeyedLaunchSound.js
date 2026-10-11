// SPDX-License-Identifier: GPL-3.0-only
/** requestEraKeyedLaunchSound — ask for one of two sounds, picked by how far the era cell has climbed:
 * with ERA_INDEX below 3 (the first three eras) one request goes out, from index 3 (the fourth era)
 * on the other does. Choosing between them is the whole content of this entry — it writes nothing
 * itself and passes nothing on, so both requests carry the code and the permission they carry
 * anywhere. LIVE-OUT: memory, through the request.
 *
 * ROM 0x3F93-0x3F9D. Grounding: [seen] (names.js ROUTINES 0x3f93).
 *
 * ROLE IN THE MACHINE. Its one caller, launchBankEnemyWhenAimedNearPlayer, has just found a free
 * slot and written a fresh record, so this request is one-to-one with an object appearing: it is
 * the sound of a craft's shot launching. Both arms go through the play-gated sound door
 * (enqueueSoundIfGameInProgress), so the attract demo stays silent.
 */

import { ERA_INDEX } from "./names.js";
import { requestEnemyLaunchSound } from "./requestEnemyLaunchSound.js";
import { requestEnemyLaunchSoundLateEra } from "./requestEnemyLaunchSoundLateEra.js";

// ERA_INDEX 0xAD04 [seen] holds the era 0-4; the ROM splits it with `cp 0x03`.
const FIRST_LATE_ERA = 3;

export function requestEraKeyedLaunchSound(m) {
  // Early eras (0-2): the code comes from the program byte at 0x07A2 (ROM tail `jp c,0x565f`).
  if (m.mem8[ERA_INDEX] < FIRST_LATE_ERA) {
    requestEnemyLaunchSound(m);
    return;
  }
  // Later eras (3-4): a different program byte, 0x4C9F (ROM tail `jp 0x5669`), so a different sound.
  requestEnemyLaunchSoundLateEra(m);
}

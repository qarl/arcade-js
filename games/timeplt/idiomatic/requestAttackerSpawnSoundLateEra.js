// SPDX-License-Identifier: GPL-3.0-only
/** requestAttackerSpawnSoundLateEra — request one particular sound, and only while a game is in progress. Its code is
 * fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x5674-0x5678 (frozen lift translated/loc_5674.js: `ld a,(0x276b) / jr 0x560c`).
 * Grounding: [seen] (names.js ROUTINES 0x5674).
 *
 * ROLE IN THE MACHINE. The main CPU asks for sounds by appending a sound code to a queue in work
 * RAM, which the frame service feeds to the audio board. enqueueSoundIfGameInProgress (0x560C) is
 * the gate that lets a code into that queue only while PLAY_ACTIVE is set, dropping it otherwise.
 * Two routines lead here: commissionStagedAttackerByEra tail-exits into it when it commissions an
 * era weapon in era 4, and requestTwoSoundsWhilePlaying runs straight on into it (no call) as the
 * second of its pair of requests. Only era 4 reaches the code directly (0x436C jp 0x5674); eras 2
 * and 3 take the mid-era path (0x4349 and 0x43AB jp 0x566E).
 *
 * The code is not an immediate: the ROM reads it from ATTACKER_SPAWN_SOUND_ERAS_2_TO_4 (0x276B), a
 * byte of the program image that names.js records as this routine's sound-command code.
 */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { ATTACKER_SPAWN_SOUND_ERAS_2_TO_4 } from "./names.js";

export function requestAttackerSpawnSoundLateEra(m) {
  // Fetch the code from ROM and tail-jump (`jr 0x560c`) into the play-only gate.
  enqueueSoundIfGameInProgress(m, m.mem8[ATTACKER_SPAWN_SOUND_ERAS_2_TO_4]);
}

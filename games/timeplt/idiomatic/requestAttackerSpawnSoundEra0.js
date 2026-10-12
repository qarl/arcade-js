// SPDX-License-Identifier: GPL-3.0-only
/** requestAttackerSpawnSoundEra0 — request one particular sound, and only while a game is in progress. Its code is
 * fetched from a byte of the program image. LIVE-OUT: memory.
 *
 * ROM 0x5664-0x5668 (frozen lift translated/loc_5664.js: `ld a,(0x16de) / jr 0x560c`).
 * Grounding: [seen] (names.js ROUTINES 0x5664).
 *
 * ROLE IN THE MACHINE. The main CPU asks for sounds by appending a sound code to a queue in work
 * RAM, which the frame service feeds to the audio board. enqueueSoundIfGameInProgress (0x560C) is
 * the gate that lets a code into that queue only while PLAY_ACTIVE is set, dropping it otherwise —
 * so the attract demo, which runs the same round engine with PLAY_ACTIVE clear, stays silent here.
 * commissionStagedAttackerByEra takes this exit on its era-0 branch, after it has set up the new
 * era weapon's sprite and record.
 *
 * The code is not an immediate: the ROM reads it from ATTACKER_SPAWN_SOUND_ERA0 (0x16DE), a byte
 * of the program image that names.js records as this routine's sound-command code.
 */

import { enqueueSoundIfGameInProgress } from "./enqueueSoundIfGameInProgress.js";
import { ATTACKER_SPAWN_SOUND_ERA0 } from "./names.js";

export function requestAttackerSpawnSoundEra0(m) {
  // Fetch the code from ROM and tail-jump (`jr 0x560c`) into the play-only gate.
  enqueueSoundIfGameInProgress(m, m.mem8[ATTACKER_SPAWN_SOUND_ERA0]);
}

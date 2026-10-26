// SPDX-License-Identifier: GPL-3.0-only
import { requestSoundIfEnabled } from "./requestSoundIfEnabled.js";

/**
 * requestEnemySpawnSound — voice a new enemy entering the tube. ROM 0xccea.
 *
 * Role in the machine: a one-line cue that requests fixed sound id 0x2f through the enable
 * gate requestSoundIfEnabled (loc_ccc3), forwarding the caller's X and Y. Its sole caller is the
 * enemy spawner spawnEntityIntoFreeSlot (0xa23f), which fires it right after seeding a fresh
 * entity into a free slot — so this is the sound of a new enemy appearing at the far rim of
 * the tube.
 *
 * Behavior: forward X (the spawned slot index) and Y, with the constant id 0x2f, into the gated
 * request; the loader stashes both in its scratch cells loc_31/loc_32. Live-out: a queued sound request when the loc_5 enable flag permits it (the gate
 * drops it otherwise). Grounding: [seen].
 */
export function requestEnemySpawnSound(m, x = m.regs.x, y = m.regs.y) {
  // id 0x2f, gated by loc_5; X carries the spawned slot index, Y rides through untouched.
  requestSoundIfEnabled(m, 0x2f, x, y);
}

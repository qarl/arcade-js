// SPDX-License-Identifier: GPL-3.0-only
/** enqueueSoundIfGameInProgress — request a sound only while a game is in progress. One permission cell decides: set,
 * and the code joins the pending-sound queue; clear, and the request is dropped silently and
 * completely, leaving no trace for a later frame to pick up. LIVE-OUT: memory.
 *
 * ROM 0x560C-0x5616 (frozen lift loc_560c). Grounding: [seen] (names.js ROUTINES 0x560C).
 *
 * Role in the machine: the main processor never talks to the audio processor directly when a
 * sound is wanted. It appends the sound code to a queue in work RAM (appendSoundCommandToQueue,
 * the enqueue body at 0x562A), and each run of the frame service sends one queued code to the audio
 * board. Producers reach that queue through one of three gates, which differ only in when they
 * let a request through:
 *   - enqueueSoundUnconditional (0x5628): always;
 *   - enqueueSoundIfGameOrDemoSoundsOn (0x5617): in play, or in attract when attract sounds are on;
 *   - this one: in play only.
 *
 * "In play" is PLAY_ACTIVE (0xAD30) [seen]. It is the only thing separating real play from the
 * attract demo — the demo runs the same round engine with this flag clear — so sounds requested
 * through this gate are silent in the demo whatever the cabinet's attract-sound setting is.
 *
 * Parameter: `command` — the sound code to queue (A in the ROM).
 */

import { appendSoundCommandToQueue } from "./appendSoundCommandToQueue.js";
import { PLAY_ACTIVE } from "./names.js";

export function enqueueSoundIfGameInProgress(m, command = m.regs.a) {
  /* The gate: ld a,(0xad30) / and a. Zero means no game, and the ROM pops its saved registers and
   * returns — the code is discarded, not deferred. */
  if (m.mem8[PLAY_ACTIVE] === 0) return;
  /* Non-zero: jr nz,0x562a into the shared enqueue body, which appends the code at the tail. */
  appendSoundCommandToQueue(m, command);
}

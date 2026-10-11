// SPDX-License-Identifier: GPL-3.0-only
/** enqueueSoundIfGameOrDemoSoundsOn — request a sound while a game is in progress, OR while the cabinet is set to make
 * sound during its attract loop. Two permission cells, tested in that order, and either one on
 * its own is enough; only with both clear is the request dropped. LIVE-OUT: memory.
 *
 * ROM 0x5617-0x5627 (frozen lift loc_5617). Grounding: [seen] (names.js ROUTINES 0x5617).
 *
 * Role in the machine: one of three gates in front of the pending-sound queue
 * (appendSoundCommandToQueue, the enqueue body at 0x562A); each later run of the frame service sends one
 * queued code to the audio board. Its siblings are enqueueSoundUnconditional (always)
 * and enqueueSoundIfGameInProgress (in play only). This one adds the attract case, so sounds
 * requested through it are heard in the attract demo too when the operator has enabled that.
 *
 * The two cells:
 *   - PLAY_ACTIVE (0xAD30) [seen] — set for the whole of a credit's play, clear in attract;
 *   - DEMO_SOUNDS_ENABLE (0xA9C6) [seen] — the attract-sound gate, one of the gameplay DIP-switch
 *     settings unpacked at boot.
 *
 * Parameter: `command` — the sound code to queue (A in the ROM).
 */

import { appendSoundCommandToQueue } from "./appendSoundCommandToQueue.js";
import { DEMO_SOUNDS_ENABLE, PLAY_ACTIVE } from "./names.js";


export function enqueueSoundIfGameOrDemoSoundsOn(m, command = m.regs.a) {
  const { mem8 } = m;
  /* The ROM tests PLAY_ACTIVE first (ld a,(0xad30) / and a / jr nz,0x562a) and only then the
   * attract-sound setting (ld a,(0xa9c6) / and a / jr nz,0x562a). Either non-zero goes straight
   * to the enqueue body; with both zero it pops its saved registers and returns, and the code
   * is discarded. */
  if (mem8[PLAY_ACTIVE] === 0 && mem8[DEMO_SOUNDS_ENABLE] === 0) return;
  appendSoundCommandToQueue(m, command);
}

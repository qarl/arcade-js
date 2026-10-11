// SPDX-License-Identifier: GPL-3.0-only
/** enqueueSoundUnconditional — request a sound with no permission test at all: the code is queued whether or not
 * a game is being played. LIVE-OUT: memory.
 *
 * ROM 0x5628-0x5629 (frozen lift loc_5628). Grounding: [seen] (names.js ROUTINES 0x5628).
 *
 * Role in the machine: the ungated one of the three ways into the pending-sound queue. In the ROM
 * it is only a two-instruction prologue — push hl / push af — that falls straight into the
 * enqueue body at 0x562A (appendSoundCommandToQueue here), the same body the two gated entries,
 * enqueueSoundIfGameInProgress and enqueueSoundIfGameOrAttract, branch into once their test
 * passes. The body steps SOUND_QUEUE_COUNT (0xAC43) [seen] on and stores the code at the new
 * tail; each run of the frame service sends the oldest queued code to the audio board.
 *
 * Its producers in the image are the six call sites in enqueueTransitionSoundBurst
 * (0x5634), that routine's tail-jump, which carries its last code, and requestCoinSound (0x57F1),
 * which loads its code and tail-jumps here. Under MAME, in attract (a
 * state the in-play gate would drop), every entry here was followed by exactly one count bump
 * and one store of the code held at entry.
 *
 * Parameter: `command` — the sound code to queue (A in the ROM).
 */

import { appendSoundCommandToQueue } from "./appendSoundCommandToQueue.js";

export function enqueueSoundUnconditional(m, command = m.regs.a) {
  /* No test: straight into the enqueue body. The queue has no room check, so a burst of requests
   * simply lengthens it (see appendSoundCommandToQueue). */
  appendSoundCommandToQueue(m, command);
}

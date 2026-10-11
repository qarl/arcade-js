// SPDX-License-Identifier: GPL-3.0-only
/** clampOneShotCountdownThenRequestTwoSounds — force the head byte of the record the index register points at to one fixed value,
 * then hand over. Whatever that byte held is discarded unread, so this is a clamp and not a step,
 * and the value is the only thing this entry contributes. LIVE-OUT: that byte, and the handover.
 *
 * ROM 0x3ECB-0x3ED1. names.js tag: [seen] -- "force the head byte of the record the caller points at
 * to 0x3B, then request two sounds (requestTwoSounds); what the byte held is discarded unread, so this
 * is a clamp and not a step".
 *
 * Role in the machine: the two-sound twin of clampOneShotCountdownThenRequestSound. Its caller is
 * runSlotCountdownDriftAndAnimateElseRetire, which first decrements a slot's countdown byte and then,
 * when the value read before that decrement was 0x3C or more, calls this to overwrite it with 0x3B. The handover is
 * requestTwoSounds (0x5683), which queues two sound codes read from program bytes
 * (TWO_SOUND_REQUEST_FIRST_CODE 0x07A6 and TWO_SOUND_REQUEST_SECOND_CODE 0x4CDA), admitted while
 * PLAY_ACTIVE or DEMO_SOUNDS_ENABLE is set (enqueueSoundIfGameOrDemoSoundsOn, 0x5617).
 *
 * `object` is the record base -- the index register the caller has seated on the current slot. */

import { requestTwoSounds } from "./requestTwoSounds.js";

// The clamp value, 0x3B (59): the same state byte clampOneShotCountdownThenRequestSound stamps.
const CLAMPED_TO = 0x3b;

export function clampOneShotCountdownThenRequestTwoSounds(m, object = m.regs.ix) {
  // `ld (ix+0x00),0x3b` at 0x3ECB: the head byte of the record takes 0x3B, unread.
  m.mem8[object] = CLAMPED_TO;
  // `jp 0x5683` at 0x3ECF, a tail jump: nothing comes back here, so this is the entry's last act.
  requestTwoSounds(m);
}

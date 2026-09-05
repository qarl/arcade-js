// SPDX-License-Identifier: GPL-3.0-only
// A dispatch arm of the sound-request handler: handles only selector 0x16 and ignores every other
// value. On a match it arms a sound sequence — clear the sub-flag, raise the active flag and its
// companion, and point the sequence-data pointer at this sequence's table.
import { loc_41cf, SOUND_SEQ_ACTIVE, loc_41d6, SOUND_SEQ_PTR, loc_1edf } from "./names.js";

// The one sound-request selector this arm handles.
const HANDLED_SELECTOR = 0x16;

// A is the sound-request selector; defaults to the live register so a translated caller behaves the same.
export function armSoundSequenceForSelector16(m, selector = m.regs.a) {
  const { mem8, mem16 } = m;

  // Only this selector belongs to this arm; anything else is another arm's request.
  if (selector !== HANDLED_SELECTOR) return;

  // Arm the sequence: clear the sub-flag, raise the active flag and companion, publish the data pointer.
  mem8[loc_41cf] = 0;
  mem8[SOUND_SEQ_ACTIVE] = 1;
  mem8[loc_41d6] = 1;
  mem16[SOUND_SEQ_PTR] = loc_1edf;
}

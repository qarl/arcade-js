// SPDX-License-Identifier: GPL-3.0-only
/** loc_3ecb — force the head byte of the record the index register points at to one fixed value,
 * then hand over. Whatever that byte held is discarded unread, so this is a clamp and not a step,
 * and the value is the only thing this entry contributes. LIVE-OUT: that byte, and the handover. */

import { requestTwoSounds } from "./requestTwoSounds.js";

const CLAMPED_TO = 0x3b;

export function loc_3ecb(m) {
  m.mem8[m.regs.ix] = CLAMPED_TO;
  requestTwoSounds(m);
}

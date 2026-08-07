// SPDX-License-Identifier: GPL-3.0-only
/** loc_41ec — zero the countdown byte inside the record a caller points at: one store, to the
 * fifth byte of that record. What the countdown gates is not decided here. LIVE-OUT: memory. */

import { u16 } from "../../../core/int.js";

const COUNTDOWN_IN_RECORD = 4;

export function loc_41ec(m, record = m.regs.ix) {
  m.mem8[u16(record + COUNTDOWN_IN_RECORD)] = 0;
}

// SPDX-License-Identifier: GPL-3.0-only
// Terminator tail of the message scroller: the countdown pointer arrives in DE, so tick that counter
// down (finishing the scroll on the zero-crossing).
import { endMessageScrollOnExpiry as loc_18e8 } from "./endMessageScrollOnExpiry.js";

export function loc_18e7(m, counterPtr = m.regs.de) {
  return loc_18e8(m, counterPtr);
}

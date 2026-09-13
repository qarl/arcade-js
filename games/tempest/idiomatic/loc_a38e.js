// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { loc_2f2 } from "./names.js";
import { loc_a398 } from "./loc_a398.js";

// Flag slot X active (loc_2f2,x = 0xff), step the lane index back by four, then tail-delegate
// the retire/spawn/award for the stepped-back slot.
export function loc_a38e(m, x = m.regs.x, y = m.regs.y) {
  const { mem8 } = m;

  mem8[u16(loc_2f2 + x)] = 0xff;
  const priorSlot = u8(y - 4);
  return loc_a398(m, x, priorSlot);
}

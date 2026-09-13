// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { loc_11c, loc_125, loc_28a, loc_2df } from "./names.js";
import { loc_a398 } from "./loc_a398.js";

// Only acts when the phase cell loc_125 is at least 3 and even. Scans loc_2df,y downward from y = loc_11c
// for the first nonzero slot: found -> clear the low two bits of loc_28a,y and tail-delegate to the slot
// handler for that slot; none found -> reset loc_125 to 0.
export function loc_a888(m, x = m.regs.x) {
  const { mem8 } = m;

  const phase = mem8[loc_125];
  if (phase < 3) return;
  if (phase & 0x01) return;

  let y = mem8[loc_11c];
  while (true) {
    if (mem8[u16(loc_2df + y)] !== 0) {
      mem8[u16(loc_28a + y)] = mem8[u16(loc_28a + y)] & 0xfc;
      return loc_a398(m, x, y);
    }
    y = u8(y - 1);
    if ((y & 0x80) === 0) continue;
    break;
  }
  mem8[loc_125] = 0;
}

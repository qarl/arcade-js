// SPDX-License-Identifier: GPL-3.0-only
import { loc_3, loc_16b, loc_4, loc_0, loc_2 } from "./names.js";
import { loc_9749 } from "./loc_9749.js";

// While the guard flag is clear, run down the delay counter; when it lands on zero
// arm the next state and clear the guard, then delegate the spinner update.
export function loc_c800(m, y = m.regs.y) {
  const { mem8 } = m;
  if ((mem8[loc_3] & mem8[loc_16b]) !== 0) return loc_9749(m, y);

  let count = mem8[loc_4];
  if (count !== 0) {
    count = (count - 1) & 0xff;
    mem8[loc_4] = count;
  }
  if (count === 0) {
    mem8[loc_0] = mem8[loc_2];
    mem8[loc_16b] = 0x00;
  }
  return loc_9749(m, y);
}

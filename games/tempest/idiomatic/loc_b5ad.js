// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { loc_106, loc_37, loc_2df, loc_57, loc_283, loc_55 } from "./names.js";
import { loc_b5d7 } from "./loc_b5d7.js";

// When the guard flag is clear, walk seven slots high-to-low; for each nonzero control
// byte cache it, split the paired slot byte into a style nibble and a doubled selector,
// then dispatch the draw handler that selector chooses for the slot.
export function loc_b5ad(m) {
  const { mem8 } = m;
  if (mem8[loc_106] & 0x80) return;
  mem8[loc_37] = 0x06;                     // loc_37 is the loop counter, seeded at 6
  while (true) {
    const x = mem8[loc_37];
    const ctrl = mem8[u16(loc_2df + x)];
    if (ctrl !== 0) {
      mem8[loc_57] = ctrl;
      const paired = mem8[u16(loc_283 + x)];
      mem8[loc_55] = (paired & 0x18) >> 3;
      loc_b5d7(m, (paired & 0x07) << 1, x); // the dispatch handler reads the slot index x
    }
    const dv = (mem8[loc_37] - 1) & 0xff;   // decrement and stop once it goes negative
    mem8[loc_37] = dv;
    if (dv & 0x80) break;
  }
}

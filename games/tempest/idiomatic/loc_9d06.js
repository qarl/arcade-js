// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  loc_202, loc_2df, loc_283, loc_3ab, loc_28a, loc_108, loc_109, loc_38, loc_10b, loc_2b9,
} from "./names.js";
import { loc_9d67 } from "./loc_9d67.js";

// Per-slot step: stash the shared byte into slot x, then act on the slot's kind.
export function loc_9d06(m, x = m.regs.x) {
  const { mem8 } = m;
  const shared = mem8[loc_202];
  mem8[u16(loc_2df + x)] = shared;

  // Kind 1 with the gate byte set: flip bit7 of the slot's flag and stop.
  if ((mem8[u16(loc_283 + x)] & 0x07) === 1 && mem8[loc_3ab] !== 0) {
    mem8[u16(loc_28a + x)] ^= 0x80;
    return;
  }
  // A negative slot just bumps its stashed byte and stops.
  if (mem8[u16(loc_283 + x)] & 0x80) {
    mem8[u16(loc_2df + x)] = u8(mem8[u16(loc_2df + x)] + 1);
    return;
  }

  mem8[loc_108] = u8(mem8[loc_108] - 1);
  if (mem8[loc_109] === 1) {
    // Scan slots 6..0 for a non-empty, non-self entry whose stashed byte matches
    // the shared one; the loser index leaks through when none matches.
    let y = 6;
    for (;;) {
      if (mem8[u16(loc_2df + y)] !== 0) {
        mem8[loc_38] = y;
        if (x !== y && mem8[u16(loc_2df + y)] === shared) break;
      }
      y = u8(y - 1);
      if (y >= 0x80) break;
    }
    // Copy the matched slot's bit6, inverted, into slot x's flag byte.
    mem8[u16(loc_283 + x)] = (mem8[u16(loc_283 + y)] & 0x40) ^ 0x40;
    m.regs.y = y; // Y here is the scan index (matched slot, or 0xff on no match), a tail live-out
  } else {
    loc_9d67(m, x);
    m.regs.y = mem8[u16(loc_2b9 + x)]; // the deeper step leaves Y = loc_2b9,x
  }

  mem8[loc_10b] = 0x41;
  mem8[loc_109] = u8(mem8[loc_109] + 1);
}

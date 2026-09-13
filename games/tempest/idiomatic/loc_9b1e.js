// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  loc_37, loc_10a, loc_10b, loc_11c, loc_143, loc_147, loc_148, loc_201, loc_291, loc_2df, loc_a0f7,
} from "./names.js";
import { loc_9b98 } from "./loc_9b98.js";
import { loc_cd06 } from "./loc_cd06.js";
import { loc_cd02 } from "./loc_cd02.js";

// When loc_201 is nonnegative, walk slots loc_37 = loc_11c down to 0: for each nonzero loc_2df,x run a
// per-entry motion pass — loc_10b indexes a table into the motion dispatcher, advancing loc_10b
// until the continue flag loc_10a clears — then store loc_10b back to loc_291,x. Then signed-accumulate the
// delta loc_147 into loc_148; a sign flip triggers the cd06/cd02 corrections; finally, when loc_148 leaves
// the [0x0f, 0xc0] band, negate loc_147 to reverse direction.
export function loc_9b1e(m) {
  const { mem8 } = m;

  if ((mem8[loc_201] & 0x80) === 0) {          // loc_201 >= 0 (else the outer walk is skipped)
    mem8[loc_37] = mem8[loc_11c];
    do {
      const x = mem8[loc_37];
      if (mem8[u16(loc_2df + x)] !== 0) {
        mem8[loc_10a] = 1;
        mem8[loc_10b] = mem8[u16(loc_291 + x)];
        do {
          m.regs.x = x; // the slot rides X into the dispatcher's handlers (which read m.regs.x)
          loc_9b98(m, mem8[u16(loc_a0f7 + mem8[loc_10b])]); // dispatch on the table entry at the cursor
          mem8[loc_10b] = u8(mem8[loc_10b] + 1);
        } while (mem8[loc_10a] !== 0);
        mem8[u16(loc_291 + x)] = mem8[loc_10b];
      }
      mem8[loc_37] = u8(mem8[loc_37] - 1);
    } while ((mem8[loc_37] & 0x80) === 0);      // until loc_37 decrements past 0
  }

  // signed accumulate loc_147 into loc_148
  const old148 = mem8[loc_148];
  const sum = u8(old148 + mem8[loc_147]);
  mem8[loc_148] = sum;
  if ((sum ^ old148) & 0x80) {                  // the accumulate crossed a sign boundary
    if (sum & 0x80) {
      loc_cd06(m);
    } else if (mem8[loc_143] !== 0 && (mem8[loc_201] & 0x80) === 0) {
      loc_cd02(m);
    }
  }

  // clamp: negate the delta when loc_148 sits in the [0x0f, 0xc0] band
  const v = mem8[loc_148];
  const negate = (v & 0x80) === 0 ? v >= 0x0f : v < 0xc1;
  if (negate) mem8[loc_147] = u8((mem8[loc_147] ^ 0xff) + 1);
}

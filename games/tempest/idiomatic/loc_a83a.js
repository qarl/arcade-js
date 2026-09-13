// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import { loc_5, loc_125, loc_201, loc_3aa, loc_4e, loc_a883 } from "./names.js";
import { loc_a888 } from "./loc_a888.js";

// Steps a countdown only while loc_5 has bit7 set. With loc_125 already running it advances it and,
// once it reaches the loc_3aa-indexed limit, restarts it and runs the sweep handler; with loc_125 idle it may
// arm the next stage (bump loc_3aa, seed loc_125) when loc_201 is clear and loc_4e bit3 is set. Every
// path clears bit7 of loc_4e on the way out.
export function loc_a83a(m) {
  const { mem8 } = m;

  if ((mem8[loc_5] & 0x80) !== 0) {
    const running = mem8[loc_125];
    if (running !== 0) {
      const advanced = u8(running + 1);
      const limitIndex = mem8[loc_3aa];
      mem8[loc_125] = advanced;
      if (advanced >= mem8[u16(loc_a883 + limitIndex)]) mem8[loc_125] = 0;
      loc_a888(m, limitIndex);
    } else if ((mem8[loc_201] & 0x80) === 0 && (mem8[loc_4e] & 0x08) !== 0) {
      if (mem8[loc_3aa] < 2) {
        mem8[loc_3aa] = mem8[loc_3aa] + 1;
        mem8[loc_125] = 1;
      }
      mem8[loc_4e] = mem8[loc_4e] & 0x77;
    }
  }

  mem8[loc_4e] = mem8[loc_4e] & 0x7f;
}

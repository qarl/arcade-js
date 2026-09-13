// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  loc_5, loc_46, loc_48, loc_49, loc_3d, loc_3e, loc_3f, loc_115, loc_158,
} from "./names.js";
import { loc_aba2 } from "./loc_aba2.js";
import { loc_c16e } from "./loc_c16e.js";
import { loc_ca62 } from "./loc_ca62.js";
import { loc_90c4 } from "./loc_90c4.js";

// Reset the per-slot state, then tail-delegate. Runs the two setup passes, and when loc_5 is
// negative a third; clears loc_49; seeds every slot from loc_3e down to 0 (loc_48,slot = loc_158,
// loc_46,slot = 0xff); clears loc_3f and loc_115; reloads loc_3d from loc_3e.
export function loc_c90c(m) {
  const { mem8 } = m;

  loc_aba2(m);
  loc_c16e(m);
  if ((mem8[loc_5] & 0x80) !== 0) loc_ca62(m);

  mem8[loc_49] = 0;

  mem8[loc_3d] = mem8[loc_3e];
  while (true) {
    const slot = mem8[loc_3d];
    mem8[u16(loc_48 + slot)] = mem8[loc_158];
    mem8[u16(loc_46 + slot)] = 0xff;
    const next = u8(mem8[loc_3d] - 1);
    mem8[loc_3d] = next;
    if ((next & 0x80) !== 0) break;
  }

  mem8[loc_3f] = 0;
  mem8[loc_115] = 0;
  mem8[loc_3d] = mem8[loc_3e];

  return loc_90c4(m);
}

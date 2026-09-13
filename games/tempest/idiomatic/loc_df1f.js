// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { loc_74, loc_31e4 } from "./names.js";
import { loc_df5f } from "./loc_df5f.js";

// Turn the low nibble into a word-table index (nibble+1), then emit that entry.
// Exit A (live-out) is the advanced cursor low byte left by the emit (the flag
// save/restore around it preserves flags, not A).
export function loc_df1f(m, a = m.regs.a) {
  return loc_df24(m, (a & 0x0f) + 1);
}

// Copy the indexed word-table entry's two bytes into the ($74) list, then step the
// cursor past them.
export function loc_df24(m, a = m.regs.a) {
  const { mem8, mem16 } = m;
  const src = u16(loc_31e4 + (a << 1));
  const dst = mem16[loc_74];
  mem8[u16(dst)] = mem8[src];
  mem8[u16(dst + 1)] = mem8[u16(src + 1)];
  return loc_df5f(m, 1);
}

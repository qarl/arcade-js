// SPDX-License-Identifier: GPL-3.0-only
import { loc_29, loc_2b, loc_36 } from "./names.js";
import { loc_9a88 } from "./loc_9a88.js";
import { loc_9aee } from "./loc_9aee.js";

// Set up a coordinate list for the packed index in loc_2b, saving and restoring the caller's
// index in loc_36 around the call. When the held count loc_29 is 0x20 or more the index selects
// one of the list-setup entries through the dispatcher; otherwise the pointer pair is seated
// directly at that index. The caller's index is returned unchanged.
export function loc_9b07(m, y = m.regs.y) {
  const { mem8 } = m;
  mem8[loc_36] = y;
  const idx = mem8[loc_2b];
  if (mem8[loc_29] >= 0x20) {
    loc_9a88(m, idx);
  } else {
    loc_9aee(m, idx);
  }
  return (m.regs.y = mem8[loc_36]);
}

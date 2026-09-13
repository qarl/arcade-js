// SPDX-License-Identifier: GPL-3.0-only
import { u8 } from "../../../core/int.js";
import { loc_1 } from "./names.js";
import { loc_d8cd } from "./loc_d8ca.js";

// Carries the incoming byte through as the burst count, derives a pass-seed from loc_1 (values >= 0x20
// fold down by 0x18, then masked to five bits), and hands both to the power-on tone burst.
export function loc_d931(m, a = m.regs.a) {
  const { mem8 } = m;
  const count = a;
  let index = mem8[loc_1];
  if (index >= 0x20) index = u8(index - 0x18);
  index &= 0x1f;
  return loc_d8cd(m, count, index);
}

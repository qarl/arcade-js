// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { loc_00, loc_3d, loc_46, loc_9f, loc_102 } from "./names.js";
import { loc_91b5 } from "./loc_91b5.js";
import { loc_ca6c } from "./loc_ca6c.js";
import { loc_ccb9 } from "./loc_ccb9.js";
import { loc_9009 } from "./loc_9009.js";

// Index off loc_3d. Bump the loc_46-slot (and loc_9f) while it is below 0x62, seed loc_00 = 0x18,
// and when the loc_102-slot is nonzero run its handler chain; then tail-delegate.
export function loc_c98c(m) {
  const { mem8 } = m;

  const idx = mem8[loc_3d];
  const slot = (loc_46 + idx) & 0xff;
  const cur = mem8[slot];
  if (cur < 0x62) {
    mem8[slot] = cur + 1;
    mem8[loc_9f] = mem8[loc_9f] + 1;
  }

  mem8[loc_00] = 0x18;

  const trigger = mem8[u16(loc_102 + idx)];
  if (trigger !== 0) {
    loc_91b5(m, trigger);
    loc_ca6c(m, 0xff);
    loc_ccb9(m);
  }

  return loc_9009(m);
}

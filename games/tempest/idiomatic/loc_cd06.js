// SPDX-License-Identifier: GPL-3.0-only
import { loc_ccc3 } from "./loc_ccc3.js";

// Trampoline: raise the fixed sound id and run the sound gate, threading X/Y to the cue.
export function loc_cd06(m, x = m.regs.x, y = m.regs.y) {
  loc_ccc3(m, 0xcf, x, y);
}

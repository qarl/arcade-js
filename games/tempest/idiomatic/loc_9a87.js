// SPDX-License-Identifier: GPL-3.0-only
import { loc_9a88 } from "./loc_9a88.js";

// Copies X into the dispatch index and runs the computed jump, tail-returning the
// selected list-setup entry's result to this routine's own caller.
export function loc_9a87(m, x = m.regs.x) {
  return loc_9a88(m, x);
}

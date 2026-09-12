// SPDX-License-Identifier: GPL-3.0-only
import { loc_b5eb } from "./loc_b5eb.js";
import { loc_b71b } from "./loc_b71b.js";
import { loc_b60f } from "./loc_b60f.js";
import { loc_b622 } from "./loc_b622.js";
import { loc_b69b } from "./loc_b69b.js";

// Computed dispatch: the caller passes A as a byte offset (0,2,4,6,8) into a 2-byte-per-entry
// table; select the draw handler and tail-return its result to this routine's own caller.
const TABLE = [loc_b5eb, loc_b71b, loc_b60f, loc_b622, loc_b69b];

export function loc_b5d7(m, a = m.regs.a, x = m.regs.x) {
  return TABLE[a >> 1](m, x);
}

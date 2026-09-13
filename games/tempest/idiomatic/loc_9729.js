// SPDX-License-Identifier: GPL-3.0-only
import { loc_123, loc_201 } from "./names.js";
import { loc_9749 } from "./loc_9749.js";
import { loc_97f8 } from "./loc_97f8.js";
import { loc_a416 } from "./loc_a416.js";
import { loc_a23f } from "./loc_a23f.js";
import { loc_a18f } from "./loc_a18f.js";
import { loc_a504 } from "./loc_a504.js";

// Per-frame update chain: clear bit7 of loc_123, run the five state updaters in order, then when
// loc_201 is negative (bit7 set) run the extra updater.
export function loc_9729(m) {
  const { mem8 } = m;
  mem8[loc_123] = mem8[loc_123] & 0x7f;
  loc_9749(m);
  loc_97f8(m);
  loc_a416(m);
  loc_a23f(m);
  loc_a18f(m);
  if (mem8[loc_201] & 0x80) loc_a504(m);
}

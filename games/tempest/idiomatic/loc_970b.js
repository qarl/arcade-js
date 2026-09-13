// SPDX-License-Identifier: GPL-3.0-only
import { loc_9749 } from "./loc_9749.js";
import { loc_a23f } from "./loc_a23f.js";
import { loc_a83a } from "./loc_a83a.js";
import { loc_98a2 } from "./loc_98a2.js";
import { loc_9b1e } from "./loc_9b1e.js";
import { loc_a18f } from "./loc_a18f.js";
import { loc_a2a6 } from "./loc_a2a6.js";
import { loc_a454 } from "./loc_a454.js";
import { loc_a416 } from "./loc_a416.js";
import { loc_a504 } from "./loc_a504.js";

// Per-frame update driver: runs the nine per-frame passes in order, then tail-delegates to the last one.
export function loc_970b(m) {
  loc_9749(m);
  loc_a23f(m);
  loc_a83a(m);
  loc_98a2(m);
  loc_9b1e(m);
  loc_a18f(m);
  loc_a2a6(m);
  loc_a454(m);
  loc_a416(m);
  return loc_a504(m);
}

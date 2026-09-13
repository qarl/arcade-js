// SPDX-License-Identifier: GPL-3.0-only
import { loc_1, loc_5b, loc_5f, loc_106 } from "./names.js";
import { loc_92c5 } from "./loc_92c5.js";
import { loc_9234 } from "./loc_9234.js";
import { loc_902b } from "./loc_902b.js";
import { loc_a831 } from "./loc_a831.js";

// Init sequence: run the four setup subroutines in order, then seed loc_5b and clear
// loc_106/loc_5f/loc_1.
export function loc_9009(m) {
  const { mem8 } = m;

  loc_92c5(m);
  loc_9234(m);
  loc_902b(m);
  loc_a831(m);

  mem8[loc_5b] = 250;
  mem8[loc_106] = 0;
  mem8[loc_5f] = 0;
  mem8[loc_1] = 0;
}

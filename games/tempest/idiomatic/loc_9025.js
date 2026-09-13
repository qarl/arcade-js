// SPDX-License-Identifier: GPL-3.0-only
import { loc_921b } from "./loc_921b.js";
import { loc_92c5 } from "./loc_92c5.js";
import { loc_902b } from "./loc_902b.js";

// Startup init: run the two seed routines in order, then tail-delegate to the main init.
export function loc_9025(m) {
  loc_921b(m);
  loc_92c5(m);
  return loc_902b(m);
}

// SPDX-License-Identifier: GPL-3.0-only
// State handler: point at the step-1 dwell timer and tick the shared two-tier cascade countdown.
import { tickCascadeCountdown as loc_0331 } from "./tickCascadeCountdown.js";
import { loc_4009 } from "./names.js";

export function loc_032e(m) {
  loc_0331(m, loc_4009);
}

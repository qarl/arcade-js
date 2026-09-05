// SPDX-License-Identifier: GPL-3.0-only
// Tick the sub-timer; while it is still counting, done. On wrap, reload it and cascade
// into the next tier of the countdown.
import { tickCascadeCountdown as loc_0331 } from "./tickCascadeCountdown.js";
import { loc_4008, loc_4009 } from "./names.js";

// Reload value written back into the sub-timer when it wraps.
const RELOAD = 60;

export function loc_0336(m) {
  const { mem8 } = m;

  const remaining = (mem8[loc_4008] - 1) & 0xff;
  mem8[loc_4008] = remaining;
  if (remaining !== 0) return; // still counting

  // Wrapped: reload and hand on to the next tier (starting at the neighbouring cell).
  mem8[loc_4008] = RELOAD;
  loc_0331(m, loc_4009);
}

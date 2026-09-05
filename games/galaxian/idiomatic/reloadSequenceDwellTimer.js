// SPDX-License-Identifier: GPL-3.0-only
// Re-arm the current mode's down-counter, reloading it to 80 frames.
import { loc_4009 } from "./names.js";

// The reload value: the timer counts down one per frame, so 80 gives this mode ~80 frames.
const TIMER_RELOAD = 80; // 0x50

export function reloadSequenceDwellTimer(m) {
  // Stamp the reload value into the mode down-counter.
  m.mem8[loc_4009] = TIMER_RELOAD;
}

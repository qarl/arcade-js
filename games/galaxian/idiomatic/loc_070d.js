// SPDX-License-Identifier: GPL-3.0-only
// Advance the sub-state counter, then re-arm the mode dwell timer.
import { reloadSequenceDwellTimer as loc_070e } from "./reloadSequenceDwellTimer.js";

export function loc_070d(m, counter = m.regs.hl) {
  m.mem8[counter] = m.mem8[counter] + 1; // bump the sub-state counter
  loc_070e(m);                           // re-arm the mode timer
}

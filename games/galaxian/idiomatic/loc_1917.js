// SPDX-License-Identifier: GPL-3.0-only
// State-3 reset of the two-byte sequencer field: clear the low byte to 0 and set the
// high byte to 9, written as two byte stores since the bytes are used independently.
import { loc_4001, loc_4002 } from "./names.js";

// The state-3 reset values: low byte cleared, high byte 9.
const LOW_RESET = 0;
const HIGH_RESET = 9;

export function loc_1917(m) {
  const { mem8 } = m;
  mem8[loc_4001] = LOW_RESET;
  mem8[loc_4002] = HIGH_RESET;
}

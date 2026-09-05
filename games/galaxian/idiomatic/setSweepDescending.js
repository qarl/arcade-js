// SPDX-License-Identifier: GPL-3.0-only
// Sets the sweep direction flag to 1 (descending phase): the oscillating mover walks its position down.
import { OBJ_SWEEP_DIRECTION } from "./names.js";

// Flag value selecting the descending (decrementing) sweep phase.
const DESCENDING = 1;

export function setSweepDescending(m) {
  const { mem8 } = m;
  // Upper bound reached: set the flag so the sweep descends.
  mem8[OBJ_SWEEP_DIRECTION] = DESCENDING;
}

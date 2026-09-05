// SPDX-License-Identifier: GPL-3.0-only
// Clears the sweep direction flag to 0 (ascending phase): the oscillating mover walks its position up.
import { OBJ_SWEEP_DIRECTION } from "./names.js";

export function setSweepAscending(m) {
  const { mem8 } = m;

  // Lower bound reached: clear the flag so the sweep ascends.
  mem8[OBJ_SWEEP_DIRECTION] = 0;
}

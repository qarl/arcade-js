// SPDX-License-Identifier: GPL-3.0-only
// Clears the sweep direction flag, reversing the oscillating mover back toward the near bound.
import { OBJ_SWEEP_DIRECTION } from "./names.js";

export function loc_0983(m) {
  const { mem8 } = m;

  // Near bound reached: reverse the sweep by clearing the direction flag.
  mem8[OBJ_SWEEP_DIRECTION] = 0;
}

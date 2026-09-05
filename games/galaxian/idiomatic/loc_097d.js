// SPDX-License-Identifier: GPL-3.0-only
// Sets the sweep direction flag to reverse, so the oscillating mover walks its position the other way.
import { OBJ_SWEEP_DIRECTION } from "./names.js";

// Flag value selecting the reversed sweep direction.
const REVERSED = 1;

export function loc_097d(m) {
  const { mem8 } = m;
  mem8[OBJ_SWEEP_DIRECTION] = REVERSED;
}

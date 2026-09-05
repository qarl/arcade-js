// SPDX-License-Identifier: GPL-3.0-only
// Two-cell-writer tail: stamp the second tile pair through the shared stamp primitive, then restore
// the caller's saved DE from the stack and hand it back. A and HL are advanced by the stamp.
import { stampTilePair as loc_25a0 } from "./stampTilePair.js";

export function loc_258c(m) {
  // A (tile), HL (dest) and DE (stride) are already staged by the caller; the stamp advances A and
  // HL and mirrors them back into the registers.
  loc_25a0(m);

  // Restore the DE the caller pushed before the pair began.
  return (m.regs.de = m.pop16());
}

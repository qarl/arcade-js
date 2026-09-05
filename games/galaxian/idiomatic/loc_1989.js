// SPDX-License-Identifier: GPL-3.0-only
// Clear the coin-lockout latch: writing 0 releases the lockout coil.
import { COIN_LOCKOUT } from "./names.js";

export function loc_1989(m) {
  const { mem8 } = m;
  mem8[COIN_LOCKOUT] = 0;
}

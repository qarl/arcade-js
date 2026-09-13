// SPDX-License-Identifier: GPL-3.0-only
import { loc_74, loc_75 } from "./names.js";

// Advance the little-endian 16-bit cursor by the stride argument plus one,
// carrying into the high byte on overflow. Exit A (live-out) is the new low
// byte of the cursor -- (mem[$74] + y + 1) & 0xff -- the value the accumulator
// holds once the cursor has advanced.
export function loc_df5f(m, y = m.regs.y) {
  const { mem8 } = m;

  const sum = mem8[loc_74] + y + 1;

  mem8[loc_74] = sum;

  if (sum > 0xff) mem8[loc_75] = mem8[loc_75] + 1;

  return (m.regs.a = sum & 0xff);
}

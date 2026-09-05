// SPDX-License-Identifier: GPL-3.0-only
// Advance the LCG pseudo-random seed one step (seed*5 + 1, wrapped to a byte),
// store it back, and return the new seed as this draw's random value.
import { RNG_SEED } from "./names.js";

export function advanceRandomSeed(m) {
  const { mem8 } = m;

  // Advance the seed one LCG step and store it back.
  const seed = mem8[RNG_SEED];
  const next = (seed * 5 + 1) & 0xff;
  mem8[RNG_SEED] = next;

  // Return the new seed as this draw's random value.
  return (m.regs.a = next);
}

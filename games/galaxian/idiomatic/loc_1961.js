// SPDX-License-Identifier: GPL-3.0-only
// Overshoot arm of a compare-and-clamp: the counter ran past its ceiling, so pin the
// cell at the pointer back to exactly the ceiling (99).

// The counter's ceiling value.
const CEILING = 99;

export function loc_1961(m, cell = m.regs.hl) {
  const { mem8 } = m;

  // Force the overshot counter back down to its ceiling.
  mem8[cell] = CEILING;
}

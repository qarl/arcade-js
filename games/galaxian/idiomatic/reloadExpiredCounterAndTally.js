// SPDX-License-Identifier: GPL-3.0-only
// Refill one expired counter cell and tally it: copies the reload byte from the
// source table into the destination cell, then bumps and returns the refill tally.

export function reloadExpiredCounterAndTally(m, src = m.regs.de, dst = m.regs.hl, count = m.regs.c) {
  const { mem8 } = m;

  // Copy the reload byte (src) into the expired counter cell (dst), re-arming it.
  mem8[dst] = mem8[src];

  // Bump the refill tally and return it.
  return (m.regs.c = (count + 1) & 0xff);
}

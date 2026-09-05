// SPDX-License-Identifier: GPL-3.0-only
// Conditional +1 gated on two look-ahead object slots: peeks the two entries
// above the base and, only if BOTH are inactive (low bit clear), bumps the
// count by one; otherwise returns it untouched. Effect is the returned value.

// Object-table entries sit 0x20 bytes apart; probe the next two slots.
const LOOKAHEAD_OFFSETS = [32, 64];

// Each entry's low bit is its active flag: set = live, clear = free.
const ACTIVE_BIT = 1;

export function loc_1292(m, count = m.regs.a, base = m.regs.ix) {
  const { mem8 } = m;

  // Bail if either look-ahead entry is still active: return the count untouched.
  for (const offset of LOOKAHEAD_OFFSETS) {
    if (mem8[base + offset] & ACTIVE_BIT) return (m.regs.a = count);
  }

  // Both inactive: bump the count (wraps at 8 bits) and return it.
  return (m.regs.a = (count + 1) & 0xff);
}

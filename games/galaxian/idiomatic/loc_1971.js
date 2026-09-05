// SPDX-License-Identifier: GPL-3.0-only
// Set-to-one arm of a two-state flag toggle: the flag bit was clear, so raise it by
// writing 1 into the cell at the pointer.

// The "on" value: with only bit 0 meaningful, 1 raises the flag.
const FLAG_ON = 1;

export function loc_1971(m, cell = m.regs.hl) {
  const { mem8 } = m;

  // Turn the flag on.
  mem8[cell] = FLAG_ON;
}

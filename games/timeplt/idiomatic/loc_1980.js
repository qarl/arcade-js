// SPDX-License-Identifier: GPL-3.0-only
/** loc_1980 — clear the byte a caller points at and hand back zero in its place, so the caller
 * tests zero rather than what was there. LIVE-OUT: the cleared cell, and the zero handed back. */

export function loc_1980(m, cell = m.regs.hl) {
  m.mem8[cell] = 0;
  m.regs.a = 0;
  return 0;
}

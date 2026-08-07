// SPDX-License-Identifier: GPL-3.0-only
/** loc_3e63 — split three ways on the head byte of the record the index register points at. Zero
 * is an exit with nothing done; all-ones and every other non-zero value each hand over to their
 * own continuation. That split is the whole of the routine: one byte read, nothing written, and
 * neither continuation is given anything this entry computed. LIVE-OUT: whatever it hands over to. */

const ALL_ONES = 255;
const ALL_ONES_ARM = 0x3e6c;
const COUNTING_ARM = 0x3e8e;

export function loc_3e63(m) {
  const head = m.mem8[m.regs.ix];
  if (head === 0) return;
  m.call(head === ALL_ONES ? ALL_ONES_ARM : COUNTING_ARM);
}

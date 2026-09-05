// SPDX-License-Identifier: GPL-3.0-only

// loc_032e  (ROM 0x032e-0x0330) — rst-28 state handler: point HL at the 0x4009 timer cell, then fall
// through into loc_0331 (the shared countdown), a genuine head also reached by jp from 0x033e.
export function loc_032e(m) {
  const { regs } = m;

  regs.hl = 0x4009;
  m.step(0x0331, 10);

  // fall-through into loc_0331 (genuine routine) -- delegate
  return m.call(0x0331);
}

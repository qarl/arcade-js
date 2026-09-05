// SPDX-License-Identifier: GPL-3.0-only

// loc_21f8  (ROM 0x21f8-0x21fd) — set IX=0x5241 (VRAM row pointer) and tail-jump to loc_2261 (shared draw).
// Reached by fall-through from loc_21a6 and by jr from 0x224b (loc_2231's region).
export function loc_21f8(m) {
  const { regs } = m;

  regs.ix = 0x5241;
  m.step(0x21fc, 14); // ld ix,0x5241 -- VRAM dest

  // jr 0x2261 -- tail into the shared draw routine
  m.step(0x2261, 12);
  return m.call(0x2261);
}

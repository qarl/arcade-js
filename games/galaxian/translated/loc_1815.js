// SPDX-License-Identifier: GPL-3.0-only

// loc_1815  (ROM 0x1815-0x1818) — store A to work-RAM 0x41c1 (the pitch source loc_16f5 latches to the
// 0x7800 pitch port) and return. Reached both by fall-through from loc_180c and by jp from loc_1801.
export function loc_1815(m) {
  const { regs, mem } = m;

  mem.write8(0x41c1, regs.a); // 0x41c1: pitch source
  m.step(0x1818, 13);

  return m.ret();
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_070e  (ROM 0x070e-0x0711) — HL=0x4009 (dec l from 0x400A), store 0x50 there, ret. Reached by jp
// from loc_0712 and loc_071d.
export function loc_070e(m) {
  const { regs, mem } = m;

  regs.l = regs.dec8(regs.l);
  m.step(0x070f, 4); // HL = 0x4009

  mem.write8(regs.hl, 0x50);
  m.step(0x0711, 10); // 0x4009 <- 0x50 (timer)

  return m.ret();
}

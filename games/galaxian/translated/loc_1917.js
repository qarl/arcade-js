// SPDX-License-Identifier: GPL-3.0-only

// loc_1917  (ROM 0x1917-0x191d) — mode-3 branch of loc_18ef: store the constant 0x0900 into the 0x4001
// word, then ret.
export function loc_1917(m) {
  const { regs, mem } = m;

  regs.hl = 0x0900;
  m.step(0x191a, 10);

  mem.write16(0x4001, regs.hl); // 0x4001/0x4002 = 0x0900
  m.step(0x191d, 16);

  return m.ret();
}

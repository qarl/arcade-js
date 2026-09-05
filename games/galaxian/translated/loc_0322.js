// SPDX-License-Identifier: GPL-3.0-only

// loc_0322  (ROM 0x0322-0x032d) — rst-28 state handler: set the state counter (0x400a)=1 and point the
// 0x4008 sequence pointer at 0x0303; ret.
export function loc_0322(m) {
  const { regs, mem } = m;

  regs.a = 0x01;
  m.step(0x0324, 7);

  mem.write8(0x400a, regs.a);
  m.step(0x0327, 13); // 0x400A <- 1 -- state counter

  regs.hl = 0x0303;
  m.step(0x032a, 10);

  mem.write16(0x4008, regs.hl);
  m.step(0x032d, 16); // ld (0x4008),hl -- sequence pointer <- 0x0303

  return m.ret();
}

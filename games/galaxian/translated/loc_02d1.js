// SPDX-License-Identifier: GPL-3.0-only

// loc_02d1  (ROM 0x02d1-0x02e7) — rst-28 state handler: enqueue two command words (0x0701, 0x0600) via
// loc_08f2, bump the state counter (0x400a), then point the 0x4008 sequence pointer at 0x1060; ret.
export function loc_02d1(m) {
  const { regs, mem } = m;

  regs.de = 0x0701;
  m.step(0x02d4, 10);

  m.push16(0x02d7);
  m.step(0x08f2, 17); // call 0x08f2 -- enqueue DE word
  m.call(0x08f2);

  regs.de = 0x0600;
  m.step(0x02da, 10);

  m.push16(0x02dd);
  m.step(0x08f2, 17); // call 0x08f2 -- enqueue DE word
  m.call(0x08f2);

  regs.hl = 0x400a;
  m.step(0x02e0, 10);

  regs.incMem8(mem, regs.hl);
  m.step(0x02e1, 11); // inc (0x400a) -- state counter

  regs.hl = 0x1060;
  m.step(0x02e4, 10);

  mem.write16(0x4008, regs.hl);
  m.step(0x02e7, 16); // ld (0x4008),hl -- sequence pointer <- 0x1060

  return m.ret();
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_018c  (ROM 0x018c-0x01bd) — sub-state 0 setup (rst-0x28 target @0x0164). Enqueues two command words
// (DE=0x0701, DE=0x0600) via 0x08f2, sets stars_enable (0x7004) + two unmapped 0x7000 latches, advances
// the sub-state index (0x400a), clears four work-RAM bytes, seeds the 0x4008 pointer word = 0x1060, ret.
export function loc_018c(m) {
  const { regs, mem } = m;

  regs.de = 0x0701;
  m.step(0x018f, 10);

  m.push16(0x0192);
  m.step(0x08f2, 17);
  m.call(0x08f2);

  regs.de = 0x0600;
  m.step(0x0195, 10);

  m.push16(0x0198);
  m.step(0x08f2, 17);
  m.call(0x08f2);

  regs.a = 0x01;
  m.step(0x019a, 7);

  mem.write8(0x4007, regs.a);
  m.step(0x019d, 13);

  mem.write8(0x7004, regs.a, 10);
  m.step(0x01a0, 13); // stars_enable_w D0 <- 1

  mem.write8(0x7002, regs.a, 10);
  m.step(0x01a3, 13); // 0x7002 unmapped in the 0x7000 block (dropped)

  mem.write8(0x7003, regs.a, 10);
  m.step(0x01a6, 13); // 0x7003 unmapped in the 0x7000 block (dropped)

  regs.hl = 0x400a;
  m.step(0x01a9, 10);

  regs.incMem8(mem, regs.hl);
  m.step(0x01aa, 11); // inc (0x400a) -- advance the sub-state index

  regs.xor(regs.a);
  m.step(0x01ab, 4);

  mem.write8(0x4019, regs.a);
  m.step(0x01ae, 13);

  mem.write8(0x400d, regs.a);
  m.step(0x01b1, 13);

  mem.write8(0x400e, regs.a);
  m.step(0x01b4, 13);

  mem.write8(0x4006, regs.a);
  m.step(0x01b7, 13);

  regs.hl = 0x1060;
  m.step(0x01ba, 10);

  mem.write16(0x4008, regs.hl);
  m.step(0x01bd, 16); // (0x4008) pointer word <- 0x1060

  m.ret();
}

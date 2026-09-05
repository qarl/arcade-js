// SPDX-License-Identifier: GPL-3.0-only

// loc_01c6  (ROM 0x01c6-0x01e0) — sub-state setup (rst-0x28 target @0x0168 and @0x0174). rst-0x10 clears
// 0x80 bytes at 0x4100, clears (0x425f)+(0x4224), seeds the VIDEORAM pointer word (0x400b)=0x5002, sets the
// (0x4009) counter=0x20 and bumps its paired byte (0x400a), ret.
export function loc_01c6(m) {
  const { regs, mem } = m;

  regs.hl = 0x4100;
  m.step(0x01c9, 10);

  regs.b = 0x80;
  m.step(0x01cb, 7);

  regs.xor(regs.a);
  m.step(0x01cc, 4); // A=0 fill byte (survives the rst-0x10 fill)

  m.push16(0x01cd);
  m.step(0x0010, 11); // rst 0x10 -- block-fill 0x4100..0x417f <- 0
  m.call(0x0010);

  mem.write8(0x425f, regs.a);
  m.step(0x01d0, 13);

  mem.write8(0x4224, regs.a);
  m.step(0x01d3, 13);

  regs.hl = 0x5002;
  m.step(0x01d6, 10);

  mem.write16(0x400b, regs.hl);
  m.step(0x01d9, 16); // (0x400b) VIDEORAM pointer word <- 0x5002

  regs.hl = 0x4009;
  m.step(0x01dc, 10);

  mem.write8(regs.hl, 0x20);
  m.step(0x01de, 10); // (0x4009) counter <- 0x20

  regs.l = regs.inc8(regs.l);
  m.step(0x01df, 4); // HL=0x400a

  regs.incMem8(mem, regs.hl);
  m.step(0x01e0, 11); // inc (0x400a)

  m.ret();
}

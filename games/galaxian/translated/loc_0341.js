// SPDX-License-Identifier: GPL-3.0-only

// loc_0341  (ROM 0x0341-0x0362) — init a descriptor slot from (HL). A=(HL); the work uses the ALT bank
// (exx): slot index = A-1, slot base = 0x4330 + rrca-x3(index) (rotate-right-3 = *32 for index<8), then
// fills fields [0]=1,[2]=0x0d,[5]=0x0c,[7]=index (others cleared; [3]/[6] skipped). Called from 0x0253.
export function loc_0341(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(regs.hl); // (HL) = descriptor number
  m.step(0x0342, 7);

  regs.exx();
  m.step(0x0343, 4); // switch to alt BC/DE/HL

  regs.a = regs.dec8(regs.a);
  m.step(0x0344, 4); // A = slot index (number-1)

  regs.b = regs.a;
  m.step(0x0345, 4);

  regs.rrca();
  m.step(0x0346, 4);

  regs.rrca();
  m.step(0x0347, 4);

  regs.rrca();
  m.step(0x0348, 4); // A = rotate-right-3(index) = index*32 mod 256

  regs.e = regs.a;
  m.step(0x0349, 4);

  regs.d = 0x00;
  m.step(0x034b, 7);

  regs.hl = 0x4330;
  m.step(0x034e, 10); // slot table base

  regs.addHl(regs.de);
  m.step(0x034f, 11); // HL = slot base

  mem.write8(regs.hl, 0x01);
  m.step(0x0351, 10); // [0]=1

  regs.l = regs.inc8(regs.l);
  m.step(0x0352, 4);

  mem.write8(regs.hl, 0x00);
  m.step(0x0354, 10); // [1]=0

  regs.l = regs.inc8(regs.l);
  m.step(0x0355, 4);

  mem.write8(regs.hl, 0x0d);
  m.step(0x0357, 10); // [2]=0x0d

  regs.l = regs.inc8(regs.l);
  m.step(0x0358, 4);

  regs.l = regs.inc8(regs.l);
  m.step(0x0359, 4); // skip [3]

  mem.write8(regs.hl, 0x00);
  m.step(0x035b, 10); // [4]=0

  regs.l = regs.inc8(regs.l);
  m.step(0x035c, 4);

  mem.write8(regs.hl, 0x0c);
  m.step(0x035e, 10); // [5]=0x0c

  regs.l = regs.inc8(regs.l);
  m.step(0x035f, 4);

  regs.l = regs.inc8(regs.l);
  m.step(0x0360, 4); // skip [6]

  mem.write8(regs.hl, regs.b);
  m.step(0x0361, 7); // [7]=index (A-1)

  regs.exx();
  m.step(0x0362, 4); // restore main bank

  m.ret();
}

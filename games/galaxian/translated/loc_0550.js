// SPDX-License-Identifier: GPL-3.0-only

// loc_0550  (ROM 0x0550-0x0582) — sub-state 0 of loc_0536: init a play field. Zero start_lamp latches
// (0x6000/0x6001), zero-fill work RAM 0x4100-0x417f, 0x4200-0x4216, 0x4218-0x422f (via inc l + b) and
// 0x4260-0x42a5 (four rst-0x10 block-fills), set (0x425f)=0, (0x4226)=1, bump (0x400a), (0x4009)=0x20,
// (0x400b/0c)=0x5000, then ret. A stays 0 through the fills (loc_0010 leaves it), so (0x425f)<-0.
export function loc_0550(m) {
  const { regs, mem } = m;

  regs.hl = 0x4100;
  m.step(0x0553, 10);

  regs.b = 0x80;
  m.step(0x0555, 7);

  regs.xor(regs.a);
  m.step(0x0556, 4); // xor a -- A=0, the fill/latch value

  mem.write8(0x6000, regs.a, 10);
  m.step(0x0559, 13); // start_lamp[0] <- 0 (io latch)

  mem.write8(0x6001, regs.a, 10);
  m.step(0x055c, 13); // start_lamp[1] <- 0 (io latch)

  m.push16(0x055d);
  m.step(0x0010, 11); // rst 0x10 -- fill 0x4100-0x417f <- 0
  m.call(0x0010);

  mem.write8(0x425f, regs.a);
  m.step(0x0560, 13); // (0x425f) <- 0

  regs.hl = 0x4200;
  m.step(0x0563, 10);

  regs.b = 0x17;
  m.step(0x0565, 7);

  m.push16(0x0566);
  m.step(0x0010, 11); // rst 0x10 -- fill 0x4200.. (0x17 bytes); leaves HL past the fill
  m.call(0x0010);

  regs.l = regs.inc8(regs.l);
  m.step(0x0567, 4); // inc l

  regs.b = 0x18;
  m.step(0x0569, 7);

  m.push16(0x056a);
  m.step(0x0010, 11); // rst 0x10 -- fill 0x18 bytes from HL
  m.call(0x0010);

  regs.hl = 0x4260;
  m.step(0x056d, 10);

  regs.b = 0x46;
  m.step(0x056f, 7);

  m.push16(0x0570);
  m.step(0x0010, 11); // rst 0x10 -- fill 0x4260-0x42a5 <- 0
  m.call(0x0010);

  regs.a = 0x01;
  m.step(0x0572, 7);

  mem.write8(0x4226, regs.a);
  m.step(0x0575, 13); // (0x4226) <- 1

  regs.hl = 0x400a;
  m.step(0x0578, 10);

  regs.incMem8(mem, regs.hl);
  m.step(0x0579, 11); // inc (0x400a) -- advance loc_0536's sub-state

  regs.l = regs.dec8(regs.l);
  m.step(0x057a, 4); // dec l -- HL=0x4009

  mem.write8(regs.hl, 0x20);
  m.step(0x057c, 10); // (0x4009) <- 0x20

  regs.hl = 0x5000;
  m.step(0x057f, 10);

  mem.write16(0x400b, regs.hl);
  m.step(0x0582, 16); // (0x400b/0c) <- 0x5000

  m.ret();
}

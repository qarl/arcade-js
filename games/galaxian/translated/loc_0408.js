// SPDX-License-Identifier: GPL-3.0-only

// loc_0408  (ROM 0x0408-0x042f) — rst-0x28 state routine (state table @0x0400, idx 0). Copies a 0x20-byte
// table from 0x1d91 into work RAM via loc_0598, zero-fills work-RAM spans (0x4060, 0x4260, then 0x42a0),
// clears (0x4238)/(0x40b0), sets pointer (0x400b)=0x5002 and (0x4009)=0x10, then bumps state (0x400a).
export function loc_0408(m) {
  const { regs, mem } = m;

  regs.hl = 0x1d91;
  m.step(0x040b, 10);

  m.push16(0x040e);
  m.step(0x0598, 17); // call 0x0598 -- copy 0x20 bytes into 0x4021 (stride 2)
  m.call(0x0598);

  regs.hl = 0x4060;
  m.step(0x0411, 10);

  regs.b = 0x40;
  m.step(0x0413, 7);

  regs.xor(regs.a);
  m.step(0x0414, 4); // xor a -- fill value 0

  m.push16(0x0415);
  m.step(0x0010, 11); // rst 0x10 -- fill 0x40 bytes at 0x4060 <- 0
  m.call(0x0010);

  regs.hl = 0x4260;
  m.step(0x0418, 10);

  m.push16(0x0419);
  m.step(0x0010, 11); // rst 0x10 -- fill 0x40 bytes at 0x4260 <- 0 (B still 0x40)
  m.call(0x0010);

  regs.b = 0x50;
  m.step(0x041b, 7);

  m.push16(0x041c);
  m.step(0x0010, 11); // rst 0x10 -- fill 0x50 bytes from HL (0x42a0) <- 0
  m.call(0x0010);

  mem.write8(0x4238, regs.a);
  m.step(0x041f, 13); // ld (0x4238),a <- 0

  mem.write8(0x40b0, regs.a);
  m.step(0x0422, 13); // ld (0x40b0),a <- 0

  regs.hl = 0x5002;
  m.step(0x0425, 10);

  mem.write16(0x400b, regs.hl);
  m.step(0x0428, 16); // ld (0x400b),hl -- pointer 0x400b/0x400c = 0x5002

  regs.hl = 0x4009;
  m.step(0x042b, 10);

  mem.write8(regs.hl, 0x10);
  m.step(0x042d, 10); // ld (hl),0x10 -- (0x4009) = 0x10

  regs.l = regs.inc8(regs.l);
  m.step(0x042e, 4); // inc l -- HL = 0x400a

  regs.incMem8(mem, regs.hl);
  m.step(0x042f, 11); // inc (0x400a) -- bump state selector

  return m.ret();
}

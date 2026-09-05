// SPDX-License-Identifier: GPL-3.0-only

// loc_1747  (ROM 0x1747-0x175c) — countdown at 0x41d1 with a pre-decrement; while it stays nonzero the
// routine returns. When it reaches 0 it (re)arms a sequencer: 0x41d1=0, 0x41d2=0x41d6=1, and stores the
// data pointer 0x1e68 into 0x41d3.
export function loc_1747(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x41d1);
  m.step(0x174a, 13);

  regs.a = regs.dec8(regs.a);
  m.step(0x174b, 4);

  if (regs.fNZ) {
    m.ret(11); // ret nz (taken) -- timer not yet expired
    return;
  }
  m.step(0x174c, 5); // ret nz (not taken)

  mem.write8(0x41d1, regs.a); // 0x41d1 = 0 (dec left Z set here)
  m.step(0x174f, 13);

  regs.a = regs.inc8(regs.a);
  m.step(0x1750, 4);

  mem.write8(0x41d2, regs.a); // 0x41d2 = 1
  m.step(0x1753, 13);

  mem.write8(0x41d6, regs.a); // 0x41d6 = 1
  m.step(0x1756, 13);

  regs.hl = 0x1e68;
  m.step(0x1759, 10);

  mem.write16(0x41d3, regs.hl); // ld (0x41d3),hl -- sequence data pointer = 0x1e68
  m.step(0x175c, 16);

  m.ret();
}

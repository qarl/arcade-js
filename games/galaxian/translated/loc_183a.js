// SPDX-License-Identifier: GPL-3.0-only

// loc_183a  (ROM 0x183a-0x184e) — loc_1819's alternate dispatch arm, entered with A = 0x41df. Only when
// the selector == 0x16 does it arm the other sound sequence: 0x41cf=0, 0x41cd=0x41d6=1, sequence pointer
// 0x41d3=0x1edf; otherwise return.
export function loc_183a(m) {
  const { regs, mem } = m;

  regs.cp(0x16);
  m.step(0x183c, 7);

  if (regs.fNZ) {
    m.ret(11); // ret nz (taken) -- selector not 0x16
    return;
  }
  m.step(0x183d, 5); // ret nz (not taken)

  regs.xor(regs.a); // A = 0
  m.step(0x183e, 4);

  mem.write8(0x41cf, regs.a); // 0x41cf = 0
  m.step(0x1841, 13);

  regs.a = regs.inc8(regs.a); // A = 1
  m.step(0x1842, 4);

  mem.write8(0x41cd, regs.a); // 0x41cd = 1 (sequence-active flag)
  m.step(0x1845, 13);

  mem.write8(0x41d6, regs.a); // 0x41d6 = 1
  m.step(0x1848, 13);

  regs.hl = 0x1edf;
  m.step(0x184b, 10);

  mem.write16(0x41d3, regs.hl); // 0x41d3 = sequence data pointer 0x1edf
  m.step(0x184e, 16);

  return m.ret();
}

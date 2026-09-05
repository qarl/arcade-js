// SPDX-License-Identifier: GPL-3.0-only

// loc_18e8  (ROM 0x18e8-0x18ee) — decrement the countdown byte at (HL). While it stays nonzero, return.
// When it hits zero, clear the scroller enable byte 0x40b0 (message done) and return.
export function loc_18e8(m) {
  const { regs, mem } = m;

  regs.decMem8(mem, regs.hl); // dec (hl) -- countdown byte
  m.step(0x18e9, 11);

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- still counting
  m.step(0x18ea, 5); // ret nz (not taken)

  regs.xor(regs.a);
  m.step(0x18eb, 4); // xor a -- A=0

  mem.write8(0x40b0, regs.a); // 0x40b0: clear scroller enable (done)
  m.step(0x18ee, 13);

  return m.ret();
}

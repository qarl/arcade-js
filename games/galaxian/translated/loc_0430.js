// SPDX-License-Identifier: GPL-3.0-only

// loc_0430  (ROM 0x0430-0x0442) — rst-0x28 state routine (state table @0x0400, idx 1). Counts down (0x4019);
// while it stays nonzero, tail-jumps to loc_0473. On reaching zero it bumps state (0x400a) and zero-fills the
// 0x80-byte work-RAM span at 0x4100, then returns.
export function loc_0430(m) {
  const { regs, mem } = m;

  regs.hl = 0x4019;
  m.step(0x0433, 10);

  regs.decMem8(mem, regs.hl);
  m.step(0x0434, 11); // dec (0x4019)

  if (regs.fNZ) {
    // jp nz,0x0473 (taken) -- still counting: tail to loc_0473
    m.step(0x0473, 10);
    return m.call(0x0473);
  }
  m.step(0x0437, 10); // jp nz,0x0473 (not taken)

  regs.hl = 0x400a;
  m.step(0x043a, 10);

  regs.incMem8(mem, regs.hl);
  m.step(0x043b, 11); // inc (0x400a) -- bump state selector

  regs.hl = 0x4100;
  m.step(0x043e, 10);

  regs.b = 0x80;
  m.step(0x0440, 7);

  regs.xor(regs.a);
  m.step(0x0441, 4); // xor a -- fill value 0

  m.push16(0x0442);
  m.step(0x0010, 11); // rst 0x10 -- fill 0x80 bytes at 0x4100 <- 0
  m.call(0x0010);

  return m.ret();
}

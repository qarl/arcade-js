// SPDX-License-Identifier: GPL-3.0-only

// loc_1801  (ROM 0x1801-0x180b) — reads (hl) & 0x03; if nonzero tail-jumps to loc_180c, else loads A=0x60
// and tail-jumps to loc_1815.
export function loc_1801(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(regs.hl);
  m.step(0x1802, 7);

  regs.and(0x03);
  m.step(0x1804, 7);

  if (regs.fNZ) {
    // jp nz,0x180c (taken) -- tail to loc_180c
    m.step(0x180c, 10);
    return m.call(0x180c);
  }
  m.step(0x1807, 10); // jp nz,0x180c (not taken)

  regs.a = 0x60;
  m.step(0x1809, 7);

  // jp 0x1815 -- tail to loc_1815
  m.step(0x1815, 10);
  return m.call(0x1815);
}

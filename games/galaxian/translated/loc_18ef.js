// SPDX-License-Identifier: GPL-3.0-only

// loc_18ef  (ROM 0x18ef-0x1916) — mode-gated input/status fold. Mode 0x4000==3 -> loc_1917. Else combine
// input cells 0x4010|0x4013, complement, mask by 0x4015 & 0x4016; bit7 set -> loc_191e; low 2 bits bump
// counter 0x4004 (once if bit0, twice if bit1 too), then ret.
export function loc_18ef(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4000); // 0x4000: game mode
  m.step(0x18f2, 13);

  regs.cp(0x03);
  m.step(0x18f4, 7);

  if (regs.fZ) {
    m.step(0x1917, 12); // jr z,0x1917 (mode 3)
    return m.call(0x1917);
  }
  m.step(0x18f6, 7); // jr z (not taken)

  regs.hl = 0x4010;
  m.step(0x18f9, 10);

  regs.a = mem.read8(regs.hl); // 0x4010
  m.step(0x18fa, 7);

  regs.l = regs.inc8(regs.l);
  m.step(0x18fb, 4);

  regs.l = regs.inc8(regs.l);
  m.step(0x18fc, 4);

  regs.l = regs.inc8(regs.l); // -> 0x4013
  m.step(0x18fd, 4);

  regs.or(mem.read8(regs.hl)); // A |= 0x4013
  m.step(0x18fe, 7);

  regs.l = regs.inc8(regs.l);
  m.step(0x18ff, 4);

  regs.l = regs.inc8(regs.l); // -> 0x4015
  m.step(0x1900, 4);

  regs.cpl();
  m.step(0x1901, 4);

  regs.and(mem.read8(regs.hl)); // A &= 0x4015
  m.step(0x1902, 7);

  regs.l = regs.inc8(regs.l); // -> 0x4016
  m.step(0x1903, 4);

  regs.and(mem.read8(regs.hl)); // A &= 0x4016
  m.step(0x1904, 7);

  regs.bit(7, regs.a); // Z = !bit7
  m.step(0x1906, 8);

  if (regs.fNZ) {
    m.step(0x191e, 12); // jr nz,0x191e (bit7 set)
    return m.call(0x191e);
  }
  m.step(0x1908, 7); // jr nz (not taken)

  regs.and(0x03);
  m.step(0x190a, 7);

  if (regs.fZ) { m.ret(11); return; } // ret z -- neither low bit
  m.step(0x190b, 5);

  regs.hl = 0x4004;
  m.step(0x190e, 10);

  regs.incMem8(mem, regs.hl); // 0x4004++
  m.step(0x190f, 11);

  regs.bit(0, regs.a); // Z = !bit0
  m.step(0x1911, 8);

  if (regs.fZ) { m.ret(11); return; } // ret z -- bit0 clear
  m.step(0x1912, 5);

  regs.and(0x02);
  m.step(0x1914, 7);

  if (regs.fZ) { m.ret(11); return; } // ret z -- bit1 clear
  m.step(0x1915, 5);

  regs.incMem8(mem, regs.hl); // 0x4004++ again
  m.step(0x1916, 11);

  return m.ret();
}

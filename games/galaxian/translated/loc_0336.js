// SPDX-License-Identifier: GPL-3.0-only

// loc_0336  (ROM 0x0336-0x0340) — advance the 0x4008 sub-timer. dec (0x4008); while nonzero just return.
// On wrap reload (0x4008)=0x3c, bump HL to 0x4009 and tail-jump into loc_0331 (dec 0x4009, cascade to
// the 0x400a phase counter). Reached by jp from 0x01c3 and 0x029a.
export function loc_0336(m) {
  const { regs, mem } = m;

  regs.hl = 0x4008;
  m.step(0x0339, 10);

  regs.decMem8(mem, regs.hl);
  m.step(0x033a, 11); // dec (0x4008)

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- still counting
  m.step(0x033b, 5);

  mem.write8(regs.hl, 0x3c);
  m.step(0x033d, 10); // (0x4008) <- 0x3c reload

  regs.l = regs.inc8(regs.l);
  m.step(0x033e, 4); // HL=0x4009

  // jp 0x0331 -- cascade into the 0x4009/0x400a tier (separate routine, delegate)
  m.step(0x0331, 10);
  return m.call(0x0331);
}

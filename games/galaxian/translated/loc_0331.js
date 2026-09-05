// SPDX-License-Identifier: GPL-3.0-only

// loc_0331  (ROM 0x0331-0x0335) — shared countdown: dec (HL); if still nonzero ret, else advance HL and
// inc the next cell (HL+1), then ret. Caller supplies HL (loc_032e passes 0x4009); also entered by jp @0x033e.
export function loc_0331(m) {
  const { regs, mem } = m;

  regs.decMem8(mem, regs.hl);
  m.step(0x0332, 11); // dec (HL) -- countdown

  if (regs.fNZ) {
    m.ret(11); // ret nz (taken) -- not yet expired
    return;
  }
  m.step(0x0333, 5); // ret nz (not taken)

  regs.l = regs.inc8(regs.l);
  m.step(0x0334, 4); // HL = HL+1

  regs.incMem8(mem, regs.hl);
  m.step(0x0335, 11); // inc (HL+1) -- bump the next cell on expiry

  return m.ret();
}

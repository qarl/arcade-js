// SPDX-License-Identifier: GPL-3.0-only

// loc_10d8  (ROM 0x10d8-0x10e3) — object handler: read field +0x04; if (field-0xc8) is in [0,5) return
// (settled), otherwise bump field +0x04 by one. Reached via the dispatch table @0x0d04 {..0x10d8..}.
export function loc_10d8(m) {
  const { regs, mem } = m;

  regs.a = mem.read8((regs.ix + 0x04) & 0xffff);
  m.step(0x10db, 19); // ld a,(ix+0x04)

  regs.sub(0xc8);
  m.step(0x10dd, 7); // sub 0xc8

  regs.cp(0x05);
  m.step(0x10df, 7); // cp 0x05

  if (regs.fC) {
    m.ret(11); // ret c -- (field-0xc8) < 5: within window, done
    return;
  }
  m.step(0x10e0, 5); // ret c (not taken)

  regs.incMem8(mem, (regs.ix + 0x04) & 0xffff);
  m.step(0x10e3, 23); // inc (ix+0x04)

  m.ret();
}

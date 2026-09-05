// SPDX-License-Identifier: GPL-3.0-only

// loc_113d  (ROM 0x113d-0x1145) — object timer tick: decrement the (ix+0x10) countdown; while it is
// still nonzero just ret, and when it reaches zero clear the object's state byte (ix+0x01)=0.
export function loc_113d(m) {
  const { regs, mem } = m;

  regs.decMem8(mem, regs.ix + 0x10);
  m.step(0x1140, 23); // dec (ix+0x10) -- countdown timer (RMW sets Z)

  if (regs.fNZ) {
    m.ret(11); // ret nz -- timer not expired yet
    return;
  }
  m.step(0x1141, 5); // ret nz (not taken)

  mem.write8(regs.ix + 0x01, 0x00);
  m.step(0x1145, 19); // ld (ix+0x01),0x00 -- timer expired: reset state byte

  m.ret();
}

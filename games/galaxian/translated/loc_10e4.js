// SPDX-License-Identifier: GPL-3.0-only

// loc_10e4  (ROM 0x10e4-0x10e7) — object sub-state dispatcher: A = field +0x02, rst 0x28 dispatch through
// the inline word table @0x10e8 {0x10f0,0x1112,0x113d,0x1146}. No continuation is pushed, so the dispatched
// routine's own ret returns to loc_10e4's caller. Reached by jp nz,0x10e4 @0x0cda.
export function loc_10e4(m) {
  const { regs, mem } = m;

  regs.a = mem.read8((regs.ix + 0x02) & 0xffff);
  m.step(0x10e7, 19); // ld a,(ix+0x02) -- sub-state index

  // rst 0x28 -- pop the pushed 0x10e8 (table base) and jp(hl) to table+2*A
  m.push16(0x10e8);
  m.step(0x0028, 11);
  return m.call(0x0028);
}

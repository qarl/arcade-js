// SPDX-License-Identifier: GPL-3.0-only

// loc_186c  (ROM 0x186c-0x1875) — stores A-1 to 0x41c1 and raises the flag at 0x41c0 (=1). Entered from
// loc_185e with A pre-loaded (0 or 0x81), or called directly.
export function loc_186c(m) {
  const { regs, mem } = m;

  regs.a = regs.dec8(regs.a);
  m.step(0x186d, 4); // dec a

  mem.write8(0x41c1, regs.a); // ld (0x41c1),a
  m.step(0x1870, 13);

  regs.a = 0x01;
  m.step(0x1872, 7); // ld a,0x01

  mem.write8(0x41c0, regs.a); // ld (0x41c0),a -- raise flag = 1
  m.step(0x1875, 13);

  m.ret();
}

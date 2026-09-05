// SPDX-License-Identifier: GPL-3.0-only

// loc_2290  (ROM 0x2290-0x229b) — pick a DE pointer by (0x400d): DE=0x40a2 when (0x400d)==0, else DE=0x40a5.
// Returns DE (no other effect).
export function loc_2290(m) {
  const { regs, mem } = m;

  regs.de = 0x40a2;
  m.step(0x2293, 10); // ld de,0x40a2

  regs.a = mem.read8(0x400d);
  m.step(0x2296, 13); // ld a,(0x400d)

  regs.and(regs.a);
  m.step(0x2297, 4); // and a -- test for zero

  if (regs.fZ) {
    m.ret(11); // ret z -- (0x400d)==0: keep DE=0x40a2
    return;
  }
  m.step(0x2298, 5); // ret z (not taken)

  regs.de = 0x40a5;
  m.step(0x229b, 10); // ld de,0x40a5

  m.ret();
}

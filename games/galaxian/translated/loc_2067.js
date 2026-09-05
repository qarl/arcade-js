// SPDX-License-Identifier: GPL-3.0-only

// loc_2067  (ROM 0x2067-0x207c) — read counter (0x425f); if its low nibble is 0, tail to loc_209c. Else
// index HL=0x4120+nibble, test bit 0 of flags (0x4238) via rrca; if set, ret. Otherwise seed the slot loop
// (C=0x10 stride, B=6 count) and fall through into loc_207d.
export function loc_2067(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x425f);
  m.step(0x206a, 13); // ld a,(0x425f) -- work RAM counter

  regs.b = regs.a;
  m.step(0x206b, 4); // ld b,a -- keep the full value (used on the two early-exit paths)

  regs.and(0x0f);
  m.step(0x206d, 7); // and 0x0f -- low nibble = active-slot count

  if (regs.fZ) {
    m.step(0x209c, 12); // jr z,0x209c (taken) -- no active slots
    return m.call(0x209c);
  }
  m.step(0x206f, 7); // jr z,0x209c (not taken)

  regs.hl = 0x4120;
  m.step(0x2072, 10); // ld hl,0x4120 -- slot table base

  regs.add(regs.l);
  m.step(0x2073, 4); // add a,l

  regs.l = regs.a;
  m.step(0x2074, 4); // ld l,a -- HL = 0x4120 + nibble

  regs.a = mem.read8(0x4238);
  m.step(0x2077, 13); // ld a,(0x4238) -- work RAM flags

  regs.rrca();
  m.step(0x2078, 4); // rrca -- carry = old bit 0

  if (regs.fC) {
    m.ret(11); // ret c (taken) -- bit 0 set
    return;
  }
  m.step(0x2079, 5); // ret c (not taken)

  regs.c = 0x10;
  m.step(0x207b, 7); // ld c,0x10 -- per-slot stride

  regs.b = 0x06;
  m.step(0x207d, 7); // ld b,0x06 -- slot count; fall through into loc_207d

  return m.call(0x207d);
}

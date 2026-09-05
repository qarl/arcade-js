// SPDX-License-Identifier: GPL-3.0-only

// loc_003c  (ROM 0x003C-0x0047) — advance the 8-bit pseudo-random seed at (0x401e): seed' = seed*5 + 1,
// store it back, ret. Callers: 0x0ec4, 0x121b, 0x1403, 0x19f2, 0x1bf9.
export function loc_003c(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x401e);
  m.step(0x003f, 13); // ld a,(0x401e) -- current seed

  regs.b = regs.a;
  m.step(0x0040, 4); // ld b,a -- keep the seed in B for the *5 term

  regs.add(regs.a);
  m.step(0x0041, 4); // add a,a -- A = seed*2

  regs.add(regs.a);
  m.step(0x0042, 4); // add a,a -- A = seed*4

  regs.add(regs.b);
  m.step(0x0043, 4); // add a,b -- A = seed*5

  regs.a = regs.inc8(regs.a);
  m.step(0x0044, 4); // inc a -- A = seed*5 + 1

  mem.write8(0x401e, regs.a);
  m.step(0x0047, 13); // ld (0x401e),a -- store the new seed (work RAM, no bus offset)

  m.ret();
}

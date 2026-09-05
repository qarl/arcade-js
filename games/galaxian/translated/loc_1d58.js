// SPDX-License-Identifier: GPL-3.0-only

// loc_1d58  (ROM 0x1d58-0x1d70) — IN0-gated work-RAM seed (sibling of loc_1c73's tail). Reads IN0 (0x6000);
// if bit 6 set, early ret. Else stores VRAM ptr 0x5000 at (0x400b), 0x20 at (0x4008), clears (0x401a)/(0x4005).
export function loc_1d58(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6000);
  m.step(0x1d5b, 13); // ld a,(0x6000) -- IN0

  regs.and(0x40);
  m.step(0x1d5d, 7); // and 0x40 -- IN0 bit 6

  if (regs.fNZ) {
    m.ret(11); // ret nz (taken) -- bail before the seed
    return;
  }
  m.step(0x1d5e, 5); // ret nz (not taken)

  regs.hl = 0x5000;
  m.step(0x1d61, 10);

  mem.write16(0x400b, regs.hl);
  m.step(0x1d64, 16); // ld (0x400b),hl -- work RAM ptr = 0x5000 (VRAM base)

  regs.a = 0x20;
  m.step(0x1d66, 7);

  mem.write8(0x4008, regs.a);
  m.step(0x1d69, 13); // (0x4008)=0x20

  regs.xor(regs.a);
  m.step(0x1d6a, 4); // xor a -- A=0

  mem.write8(0x401a, regs.a);
  m.step(0x1d6d, 13); // (0x401a)=0

  mem.write8(0x4005, regs.a);
  m.step(0x1d70, 13); // (0x4005)=0

  m.ret();
}

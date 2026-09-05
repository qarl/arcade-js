// SPDX-License-Identifier: GPL-3.0-only

// loc_1876  (ROM 0x1876-0x1885) — down-counter at 0x41c9 with a pre-decrement. While it stays nonzero, tail
// into loc_1886. When it reaches 0: write 0 back to 0x41c9 and set the 16-bit word at 0x41ca to 0x0020.
export function loc_1876(m) {
  const { regs, mem } = m;

  regs.hl = 0x41c9;
  m.step(0x1879, 10); // ld hl,0x41c9

  regs.a = mem.read8(regs.hl);
  m.step(0x187a, 7); // ld a,(hl)

  regs.a = regs.dec8(regs.a);
  m.step(0x187b, 4); // dec a

  if (regs.fNZ) {
    // jp nz,0x1886 (taken) -- counter not expired: delegate to loc_1886
    m.step(0x1886, 10);
    return m.call(0x1886);
  }
  m.step(0x187e, 10); // jp nz,0x1886 (not taken)

  mem.write8(regs.hl, regs.a); // ld (hl),a -- 0x41c9 = 0
  m.step(0x187f, 7);

  regs.hl = 0x0020;
  m.step(0x1882, 10); // ld hl,0x0020

  mem.write16(0x41ca, regs.hl); // ld (0x41ca),hl -- word 0x41ca = 0x0020
  m.step(0x1885, 16);

  m.ret();
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_03af  (ROM 0x03af-0x03bf) — copy 3 bytes from (HL) up a VRAM column at (DE), DE stepping -0x20 per
// byte, then advance E by +0x62 to line up the next column. Called from loc_0367 (0x038c and the 0x0394 loop).
export function loc_03af(m) {
  const { regs, mem } = m;

  regs.c = 0x03;
  m.step(0x03b1, 7); // ld c,0x03 -- 3 bytes

  for (;;) {
    // loc_03b1:
    regs.a = mem.read8(regs.hl);
    m.step(0x03b2, 7); // ld a,(hl) -- source byte

    mem.write8(regs.de, regs.a);
    m.step(0x03b3, 7); // ld (de),a -- VRAM cell

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x03b4, 6); // inc hl

    regs.a = regs.e;
    m.step(0x03b5, 4); // ld a,e

    regs.sub(0x20);
    m.step(0x03b7, 7); // sub 0x20 -- up one row

    regs.e = regs.a;
    m.step(0x03b8, 4); // ld e,a

    regs.c = regs.dec8(regs.c);
    m.step(0x03b9, 4); // dec c

    if (regs.fNZ) {
      m.step(0x03b1, 10); // jp nz,0x03b1 (taken)
      continue;
    }
    m.step(0x03bc, 10); // jp nz,0x03b1 (not taken)
    break;
  }

  regs.add(0x62);
  m.step(0x03be, 7); // add a,0x62 -- E advances to the next column

  regs.e = regs.a;
  m.step(0x03bf, 4); // ld e,a

  m.ret();
}

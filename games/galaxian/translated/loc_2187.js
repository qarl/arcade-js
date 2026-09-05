// SPDX-License-Identifier: GPL-3.0-only

// loc_2187  (ROM 0x2187-0x219a) — blank a 4x4 VRAM tile block: write 0x40 to four rows of four cells from
// 0x51da, stepping +0x1c between rows (0x51da, 0x51fa, 0x521a, 0x523a). 218f/2191 are the interior loop
// tops. Also called from loc_219b.
export function loc_2187(m) {
  const { regs, mem } = m;

  regs.hl = 0x51da; // VRAM block origin
  m.step(0x218a, 10);

  regs.de = 0x001c; // row stride
  m.step(0x218d, 10);

  regs.c = 0x04;
  m.step(0x218f, 7);

  for (;;) {
    // 218f: row loop top
    regs.b = 0x04;
    m.step(0x2191, 7);

    for (;;) {
      // 2191: cell loop top
      mem.write8(regs.hl, 0x40); // blank tile
      m.step(0x2193, 10);

      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x2194, 6);

      if (regs.djnz() !== 0) {
        m.step(0x2191, 13); // djnz taken
        continue;
      }
      m.step(0x2196, 8); // djnz not taken
      break;
    }

    regs.addHl(regs.de);
    m.step(0x2197, 11);

    regs.c = regs.dec8(regs.c);
    m.step(0x2198, 4);

    if (regs.fNZ) {
      m.step(0x218f, 12); // jr nz,0x218f (taken)
      continue;
    }
    m.step(0x219a, 7); // jr nz not taken
    break;
  }

  m.ret();
}

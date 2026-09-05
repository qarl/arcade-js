// SPDX-License-Identifier: GPL-3.0-only

// loc_16b8  (ROM 0x16b8-0x16f4) — gated by 0x4007 D0. Sums 6 rows of 10 bytes at 0x4123 (row stride 16),
// seeded with 1; the total A drives how many of the 3 sound_w latches at 0x6800 get 0x01 (loc_16d6) before
// the rest are zeroed (loc_16ed). Finally sets 0x4224 = (A<2 ? 1 : 0) at loc_16de.
export function loc_16b8(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4007);
  m.step(0x16bb, 13);

  regs.rrca();
  m.step(0x16bc, 4); // C <- 0x4007 D0

  if (regs.fC) { m.ret(11); return; } // ret c
  m.step(0x16bd, 5);

  regs.hl = 0x4123;
  m.step(0x16c0, 10);

  regs.de = 0x0006;
  m.step(0x16c3, 10); // row-gap stride

  regs.c = regs.e;
  m.step(0x16c4, 4); // C = 6 rows

  regs.a = 0x01;
  m.step(0x16c6, 7); // seed

  // loc_16c6: outer row loop
  for (;;) {
    regs.b = 0x0a;
    m.step(0x16c8, 7); // 10 bytes per row

    // loc_16c8: inner sum loop
    for (;;) {
      regs.add(mem.read8(regs.hl));
      m.step(0x16c9, 7); // add a,(hl)

      regs.l = regs.inc8(regs.l);
      m.step(0x16ca, 4);

      if (regs.djnz() !== 0) { m.step(0x16c8, 13); continue; }
      m.step(0x16cc, 8);
      break;
    }

    regs.addHl(regs.de);
    m.step(0x16cd, 11); // skip to next row

    regs.c = regs.dec8(regs.c);
    m.step(0x16ce, 4);

    if (regs.fNZ) { m.step(0x16c6, 10); continue; } // jp nz,0x16c6
    m.step(0x16d1, 10);
    break;
  }

  regs.hl = 0x6800;
  m.step(0x16d4, 10); // sound_w base

  regs.b = 0x03;
  m.step(0x16d6, 7);

  // loc_16d6: write 0x01 to A latches, then loc_16ed clears the remainder
  for (;;) {
    regs.a = regs.dec8(regs.a);
    m.step(0x16d7, 4);

    if (regs.fZ) {
      m.step(0x16ed, 12); // jr z,0x16ed
      // loc_16ed: zero the remaining B latches
      for (;;) {
        mem.write8(regs.hl, 0x00, 7);
        m.step(0x16ef, 10); // sound_w <- 0

        regs.l = regs.inc8(regs.l);
        m.step(0x16f0, 4);

        if (regs.djnz() !== 0) { m.step(0x16ed, 13); continue; }
        m.step(0x16f2, 8);
        break;
      }
      m.step(0x16de, 10); // jp 0x16de
      break;
    }

    m.step(0x16d9, 7);
    mem.write8(regs.hl, 0x01, 7);
    m.step(0x16db, 10); // sound_w <- 1

    regs.l = regs.inc8(regs.l);
    m.step(0x16dc, 4);

    if (regs.djnz() !== 0) { m.step(0x16d6, 13); continue; }
    m.step(0x16de, 8);
    break;
  }

  // loc_16de:
  regs.cp(0x02);
  m.step(0x16e0, 7);

  if (regs.fC) {
    m.step(0x16e7, 12); // jr c,0x16e7
    regs.a = 0x01;
    m.step(0x16e9, 7);
    mem.write8(0x4224, regs.a);
    m.step(0x16ec, 13); // 0x4224 <- 1
    m.ret();
    return;
  }

  m.step(0x16e2, 7);
  regs.xor(regs.a);
  m.step(0x16e3, 4);

  mem.write8(0x4224, regs.a);
  m.step(0x16e6, 13); // 0x4224 <- 0

  m.ret();
}

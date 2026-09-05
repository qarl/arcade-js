// SPDX-License-Identifier: GPL-3.0-only

// loc_03c0  (ROM 0x03c0-0x03d6) — blank a B-wide VRAM block: for each of B columns write tile 0x10 to 3
// cells stepping up -0x20/row (HL+=0xffe0), then advance the column by L+=0x62. Entered by jr z from loc_0367.
export function loc_03c0(m) {
  const { regs, mem } = m;

  regs.hl = 0x5193;
  m.step(0x03c3, 10); // ld hl,0x5193 -- VRAM start cell

  regs.de = 0xffe0;
  m.step(0x03c6, 10); // ld de,-0x20 -- row step (upward)

  for (;;) {
    // loc_03c6:
    regs.c = 0x03;
    m.step(0x03c8, 7); // ld c,0x03 -- 3 rows

    regs.a = 0x10;
    m.step(0x03ca, 7); // ld a,0x10 -- blank tile

    for (;;) {
      // loc_03ca:
      mem.write8(regs.hl, regs.a);
      m.step(0x03cb, 7); // ld (hl),a

      regs.addHl(regs.de);
      m.step(0x03cc, 11); // add hl,de -- up one row

      regs.c = regs.dec8(regs.c);
      m.step(0x03cd, 4); // dec c

      if (regs.fNZ) {
        m.step(0x03ca, 10); // jp nz,0x03ca (taken)
        continue;
      }
      m.step(0x03d0, 10); // jp nz,0x03ca (not taken)
      break;
    }

    regs.a = regs.l;
    m.step(0x03d1, 4); // ld a,l

    regs.add(0x62);
    m.step(0x03d3, 7); // add a,0x62 -- next column

    regs.l = regs.a;
    m.step(0x03d4, 4); // ld l,a

    if (regs.djnz() !== 0) {
      m.step(0x03c6, 13); // djnz 0x03c6 (taken)
      continue;
    }
    m.step(0x03d6, 8); // djnz 0x03c6 (not taken)
    break;
  }

  m.ret();
}

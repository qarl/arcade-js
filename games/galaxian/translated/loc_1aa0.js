// SPDX-License-Identifier: GPL-3.0-only

// loc_1aa0  (ROM 0x1aa0-0x1ab0) — WORK-RAM march-test WRITE loop of the power-on RAM test. loc_1a9a set
// HL=0x4000, B=4, A=C (seed); writes A+0x2F to each byte of 0x4000-0x43FF, bumping A by 1 per page. Then
// re-seeds HL/B/A and falls through into loc_1ab1 (the READ-BACK verify loop).
export function loc_1aa0(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1aa0:
    regs.add(0x2f);
    m.step(0x1aa2, 7); // add a,0x2f

    mem.write8(regs.hl, regs.a); // ld (hl),a -- work RAM (0x40xx), plain RAM write
    m.step(0x1aa3, 7);

    regs.l = regs.inc8(regs.l);
    m.step(0x1aa4, 4); // inc l

    if (regs.fNZ) {
      // jp nz,0x1aa0 (taken) -- next byte of this page
      m.step(0x1aa0, 10);
      continue;
    }
    m.step(0x1aa7, 10); // jp nz,0x1aa0 (not taken; jp cc is 10 T either way)

    regs.a = regs.inc8(regs.a);
    m.step(0x1aa8, 4); // inc a -- bump the seed between pages

    regs.h = regs.inc8(regs.h);
    m.step(0x1aa9, 4); // inc h -- next page

    if (regs.djnz() !== 0) {
      // djnz 0x1aa0 (taken) -- more of the 4 pages
      m.step(0x1aa0, 13);
      continue;
    }
    m.step(0x1aab, 8); // djnz 0x1aa0 (not taken)
    break;
  }

  regs.hl = 0x4000;
  m.step(0x1aae, 10); // ld hl,0x4000 -- re-seed HL for the verify pass

  regs.b = 0x04;
  m.step(0x1ab0, 7); // ld b,0x04

  regs.a = regs.c;
  m.step(0x1ab1, 4); // ld a,c

  // fall-through into loc_1ab1 (the work-RAM read-back verify loop) -- separate routine, delegate
  return m.call(0x1ab1);
}

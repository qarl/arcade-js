// SPDX-License-Identifier: GPL-3.0-only

// loc_1ad0  (ROM 0x1ad0-0x1ae3) — VIDEORAM march-test WRITE loop of the power-on RAM test (the VIDEORAM
// twin of loc_1aa0). loc_1aca set HL=0x5000, B=4, A=C (seed); writes A+0x2F to each byte of 0x5000-0x53FF,
// bumping A by 1 per page. Then pets the watchdog, re-seeds HL/B/A and falls through into loc_1ae4 (the VRAM
// READ-BACK verify loop).
export function loc_1ad0(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1ad0:
    regs.add(0x2f);
    m.step(0x1ad2, 7); // add a,0x2f

    mem.write8(regs.hl, regs.a); // ld (hl),a -- VIDEORAM (0x50xx), plain RAM write
    m.step(0x1ad3, 7);

    regs.l = regs.inc8(regs.l);
    m.step(0x1ad4, 4); // inc l

    if (regs.fNZ) {
      // jp nz,0x1ad0 (taken) -- next byte of this page
      m.step(0x1ad0, 10);
      continue;
    }
    m.step(0x1ad7, 10); // jp nz,0x1ad0 (not taken; jp cc is 10 T either way)

    regs.a = regs.inc8(regs.a);
    m.step(0x1ad8, 4); // inc a -- bump the seed between pages

    regs.h = regs.inc8(regs.h);
    m.step(0x1ad9, 4); // inc h -- next page

    if (regs.djnz() !== 0) {
      // djnz 0x1ad0 (taken) -- more of the 4 pages
      m.step(0x1ad0, 13);
      continue;
    }
    m.step(0x1adb, 8); // djnz 0x1ad0 (not taken)
    break;
  }

  regs.a = mem.read8(0x7800);
  m.step(0x1ade, 13); // ld a,(0x7800) -- watchdog reset (pet the dog); read floats 0xFF, discarded

  regs.hl = 0x5000;
  m.step(0x1ae1, 10); // ld hl,0x5000 -- re-seed HL for the verify pass

  regs.b = 0x04;
  m.step(0x1ae3, 7); // ld b,0x04

  regs.a = regs.c;
  m.step(0x1ae4, 4); // ld a,c

  // fall-through into loc_1ae4 (the VIDEORAM read-back verify loop) -- separate routine, delegate
  return m.call(0x1ae4);
}

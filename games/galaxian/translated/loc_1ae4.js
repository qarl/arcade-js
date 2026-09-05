// SPDX-License-Identifier: GPL-3.0-only

// loc_1ae4  (ROM 0x1ae4-0x1afa) — VIDEORAM march-test READ-BACK loop of the power-on RAM test. Regenerates
// the same A-sequence loc_1aca wrote (seed=C, +0x2F/byte, +1/page) across 0x5000-0x53FF and compares the
// read-back; a mismatch tail-jumps to fail path loc_1aff. A clean pass pets the watchdog, dec's seed C, and
// retests with the next seed (loc_1aca) or, when C hits 0, tail-jumps to the next test stage 0x1b70.
export function loc_1ae4(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1ae4:
    regs.add(0x2f);
    m.step(0x1ae6, 7); // add a,0x2f

    regs.cp(mem.read8(regs.hl));
    m.step(0x1ae7, 7); // cp (hl) -- pattern vs VRAM read-back

    if (regs.fNZ) {
      // jr nz,0x1aff (taken) -- mismatch: tail to the RAM-test fail path
      m.step(0x1aff, 12);
      return m.call(0x1aff);
    }
    m.step(0x1ae9, 7); // jr nz,0x1aff (not taken)

    regs.l = regs.inc8(regs.l);
    m.step(0x1aea, 4); // inc l

    if (regs.fNZ) {
      // jp nz,0x1ae4 (taken) -- next byte of this page
      m.step(0x1ae4, 10);
      continue;
    }
    m.step(0x1aed, 10); // jp nz,0x1ae4 (not taken; jp cc is 10 T either way)

    regs.a = regs.inc8(regs.a);
    m.step(0x1aee, 4); // inc a -- bump the seed between pages

    regs.h = regs.inc8(regs.h);
    m.step(0x1aef, 4); // inc h -- next page

    if (regs.djnz() !== 0) {
      // djnz 0x1ae4 (taken) -- more of the 4 pages
      m.step(0x1ae4, 13);
      continue;
    }
    m.step(0x1af1, 8); // djnz 0x1ae4 (not taken)

    regs.a = mem.read8(0x7800);
    m.step(0x1af4, 13); // ld a,(0x7800) -- watchdog reset (pet the dog)

    regs.c = regs.dec8(regs.c);
    m.step(0x1af5, 4); // dec c -- outer seed counter

    if (regs.fNZ) {
      // jp nz,0x1aca (taken) -- retest with the next seed
      m.step(0x1aca, 10);
      return m.call(0x1aca);
    }
    m.step(0x1af8, 10); // jp nz,0x1aca (not taken)

    // jp 0x1b70 -- all seeds passed: tail to the next test stage
    m.step(0x1b70, 10);
    return m.call(0x1b70);
  }
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_1ab1  (ROM 0x1ab1-0x1ac9) — WORK-RAM march-test READ-BACK loop of the power-on RAM test. Regenerates
// the same A-sequence loc_1aa0 wrote (seed=C, +0x2F/byte, +1/page) across 0x4000-0x43FF and compares the
// read-back; a mismatch tail-jumps to fail path loc_1afb. A clean pass pets the watchdog, dec's seed C, and
// retests with the next seed (loc_1a9a) or, when C hits 0, sets SP=0x4400, C=0x20 and falls through into
// the VIDEORAM test setup loc_1aca.
export function loc_1ab1(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1ab1:
    regs.add(0x2f);
    m.step(0x1ab3, 7); // add a,0x2f

    regs.cp(mem.read8(regs.hl));
    m.step(0x1ab4, 7); // cp (hl) -- pattern vs work-RAM read-back

    if (regs.fNZ) {
      // jr nz,0x1afb (taken) -- mismatch: tail to the RAM-test fail path
      m.step(0x1afb, 12);
      return m.call(0x1afb);
    }
    m.step(0x1ab6, 7); // jr nz,0x1afb (not taken)

    regs.l = regs.inc8(regs.l);
    m.step(0x1ab7, 4); // inc l

    if (regs.fNZ) {
      // jp nz,0x1ab1 (taken) -- next byte of this page
      m.step(0x1ab1, 10);
      continue;
    }
    m.step(0x1aba, 10); // jp nz,0x1ab1 (not taken; jp cc is 10 T either way)

    regs.a = regs.inc8(regs.a);
    m.step(0x1abb, 4); // inc a -- bump the seed between pages

    regs.h = regs.inc8(regs.h);
    m.step(0x1abc, 4); // inc h -- next page

    if (regs.djnz() !== 0) {
      // djnz 0x1ab1 (taken) -- more of the 4 pages
      m.step(0x1ab1, 13);
      continue;
    }
    m.step(0x1abe, 8); // djnz 0x1ab1 (not taken)
    break;
  }

  regs.a = mem.read8(0x7800);
  m.step(0x1ac1, 13); // ld a,(0x7800) -- watchdog reset (pet the dog); read floats 0xFF, discarded

  regs.c = regs.dec8(regs.c);
  m.step(0x1ac2, 4); // dec c -- outer seed counter

  if (regs.fNZ) {
    // jp nz,0x1a9a (taken) -- retest work RAM with the next seed
    m.step(0x1a9a, 10);
    return m.call(0x1a9a);
  }
  m.step(0x1ac5, 10); // jp nz,0x1a9a (not taken)

  regs.sp = 0x4400;
  m.step(0x1ac8, 10); // ld sp,0x4400 -- work RAM verified: stack pointer into RAM

  regs.c = 0x20;
  m.step(0x1aca, 7); // ld c,0x20 -- seed counter for the VIDEORAM test

  // fall-through into loc_1aca (the VIDEORAM test setup) -- separate routine, delegate
  return m.call(0x1aca);
}

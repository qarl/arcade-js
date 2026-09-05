// SPDX-License-Identifier: GPL-3.0-only

// loc_1a5c  (ROM 0x1A5C-0x1A6A) — VRAM page-fill loop of the cold-boot wipe. Fills one 256-byte page at HL
// with A (=0x10 blank tile), pets the watchdog per page, djnz for B=4 pages (0x5000-0x53FF). Then points
// HL at OBJRAM (0x5800), zeroes A, and falls through into the OBJRAM-clear loop at loc_1a6b.
export function loc_1a5c(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1a5c:
    mem.write8(regs.hl, regs.a);
    m.step(0x1a5d, 7); // ld (hl),a -- fill one VRAM byte

    regs.l = regs.inc8(regs.l);
    m.step(0x1a5e, 4); // inc l -- Z when the page wraps (L back to 0)

    if (regs.fNZ) {
      m.step(0x1a5c, 10); // jp nz,0x1a5c (taken) -- next byte of this page
      continue;
    }
    m.step(0x1a61, 10); // jp nz,0x1a5c (not taken) -- page done
    break;
  }

  regs.h = regs.inc8(regs.h);
  m.step(0x1a62, 4); // inc h -- advance to the next page

  regs.a = mem.read8(0x7800);
  m.step(0x1a65, 13); // ld a,(0x7800) -- watchdog reset read (returns 0xFF)

  if (m.regs.djnz() !== 0) {
    m.step(0x1a5a, 13); // djnz 0x1a5a (taken) -> loc_1a5a to reload the fill byte for the next page
    return m.call(0x1a5a);
  }
  m.step(0x1a67, 8); // djnz 0x1a5a (not taken) -- all 4 pages (0x5000-0x53FF) cleared

  regs.hl = 0x5800;
  m.step(0x1a6a, 10); // ld hl,0x5800 -- point at OBJRAM

  regs.xor(regs.a);
  m.step(0x1a6b, 4); // xor a -- A=0 (OBJRAM clear value)

  // fall-through into loc_1a6b (the OBJRAM-clear loop) -- delegate, do not inline
  return m.call(0x1a6b);
}

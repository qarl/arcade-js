// SPDX-License-Identifier: GPL-3.0-only

// loc_1d39  (ROM 0x1d39-0x1d42) — first half of the tile-strip fill: writes the byte pair 0x30,0x32 to the
// alt-set VRAM cursor HL, B times (B=16 from loc_1d28), advancing HL by 2 each pass. Then reloads B=16 and
// falls into the second-half loop (loc_1d43). Data-dependent T-total; the entry contract is B=0x10.
export function loc_1d39(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1d39:
    mem.write8(regs.hl, 0x30); // tile code 0x30 -> VRAM
    m.step(0x1d3b, 10);

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1d3c, 6);

    mem.write8(regs.hl, 0x32); // tile code 0x32 -> VRAM
    m.step(0x1d3e, 10);

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1d3f, 6);

    if (regs.djnz() !== 0) {
      m.step(0x1d39, 13); // djnz (taken)
      continue;
    }
    m.step(0x1d41, 8); // djnz (not taken)
    break;
  }

  regs.b = 0x10;
  m.step(0x1d43, 7); // 16 pairs for the second half

  // fall-through into loc_1d43
  return m.call(0x1d43);
}

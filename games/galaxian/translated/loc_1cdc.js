// SPDX-License-Identifier: GPL-3.0-only

// loc_1cdc  (ROM 0x1cdc-0x1cea) — unstack a descriptor record. Reads B (=2) 16-bit words from (HL) and
// pushes each, then takes the record's 5th byte as the draw count (B). Swaps to the shadow bank and pops
// the two words as HL'=dest (VRAM) and DE'=source, sets BC'=0xffe0 (=-0x20 column stride), swaps back so
// the main-bank B is the count, and falls through into loc_1ceb (the draw loop).
export function loc_1cdc(m) {
  const { regs, mem } = m;

  for (;;) {
    regs.e = mem.read8(regs.hl);
    m.step(0x1cdd, 7); // ld e,(hl) -- word low byte

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1cde, 6);

    regs.d = mem.read8(regs.hl);
    m.step(0x1cdf, 7); // ld d,(hl) -- word high byte

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1ce0, 6);

    m.push16(regs.de);
    m.step(0x1ce1, 11); // push de -- stash for the shadow-bank pops below

    if (regs.djnz() !== 0) {
      m.step(0x1cdc, 13); // djnz (taken) -- next word
      continue;
    }
    m.step(0x1ce3, 8); // djnz (not taken)
    break;
  }

  regs.b = mem.read8(regs.hl);
  m.step(0x1ce4, 7); // ld b,(hl) -- record byte 5 = draw count for loc_1ceb

  regs.exx();
  m.step(0x1ce5, 4); // exx -- to shadow bank

  regs.hl = m.pop16();
  m.step(0x1ce6, 10); // pop hl -- HL' = last word pushed = dest (VRAM)

  regs.de = m.pop16();
  m.step(0x1ce7, 10); // pop de -- DE' = first word = source

  regs.bc = 0xffe0;
  m.step(0x1cea, 10); // ld bc,0xffe0 -- BC' = -0x20 (one column up per write)

  regs.exx();
  m.step(0x1ceb, 4); // exx -- back to main bank (B = draw count)

  // fall-through into loc_1ceb (the draw loop) -- separate routine, delegate
  return m.call(0x1ceb);
}

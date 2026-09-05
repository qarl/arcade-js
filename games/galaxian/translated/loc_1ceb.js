// SPDX-License-Identifier: GPL-3.0-only

// loc_1ceb  (ROM 0x1ceb-0x1cf5) — the draw loop. For B (main-bank) chars, copy a source byte (shadow DE')
// minus 0x30 ('0'.. -> tile code) into VRAM (shadow HL'), advancing the dest by BC'=0xffe0 (-0x20, one
// screen column up in the column-major layout) each write. Rets when B hits 0.
export function loc_1ceb(m) {
  const { regs, mem } = m;

  for (;;) {
    regs.exx();
    m.step(0x1cec, 4); // exx -- to shadow bank (DE'=src, HL'=dest, BC'=stride)

    regs.a = mem.read8(regs.de);
    m.step(0x1ced, 7); // ld a,(de) -- source byte

    regs.sub(0x30);
    m.step(0x1cef, 7); // sub 0x30 -- '0'.. -> tile code

    mem.write8(regs.hl, regs.a);
    m.step(0x1cf0, 7); // ld (hl),a -- store into the VRAM char cell

    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x1cf1, 6);

    regs.addHl(regs.bc);
    m.step(0x1cf2, 11); // add hl,bc -- dest += -0x20 (up one column)

    regs.exx();
    m.step(0x1cf3, 4); // exx -- back to main bank (B counter)

    if (regs.djnz() !== 0) {
      m.step(0x1ceb, 13); // djnz (taken) -- next char
      continue;
    }
    m.step(0x1cf5, 8); // djnz (not taken)
    break;
  }

  m.ret();
}

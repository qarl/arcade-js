// SPDX-License-Identifier: GPL-3.0-only

// loc_1b13  (ROM 0x1B13-0x1B1A) — exx-based strided VRAM copy loop set up by loc_1b0a. Each pass swaps in
// the shadow set (HL'=dest, BC'=0x0020 stride, DE'=source), copies one byte, advances dest by the column
// stride and source by one, swaps the counter B back and djnz's (B=0x07 = 7 rows down one column). When B
// hits 0 it falls through into loc_1b1b.
export function loc_1b13(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1b13:
    regs.exx();
    m.step(0x1b14, 4); // exx -- HL/BC/DE now the copy set (HL=dest, BC=0x20, DE=source)

    regs.a = mem.read8(regs.de);
    m.step(0x1b15, 7); // ld a,(de) -- A = source byte

    mem.write8(regs.hl, regs.a);
    m.step(0x1b16, 7); // ld (hl),a -- VRAM write (0x5000 block, not a hardware latch)

    regs.addHl(regs.bc);
    m.step(0x1b17, 11); // add hl,bc -- advance dest by one column stride

    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x1b18, 6); // inc de -- advance source

    regs.exx();
    m.step(0x1b19, 4); // exx -- counter B back into the main set

    if (regs.djnz() !== 0) {
      m.step(0x1b13, 13); // djnz 0x1b13 (taken) -- next row
      continue;
    }
    m.step(0x1b1b, 8); // djnz (not taken) -- 7 rows copied
    break;
  }

  // fall-through into loc_1b1b (clear-NMI / spin-then-reboot) -- delegate, do not inline
  return m.call(0x1b1b);
}

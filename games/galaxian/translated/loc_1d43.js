// SPDX-License-Identifier: GPL-3.0-only

// loc_1d43  (ROM 0x1d43-0x1d50) — second half of the tile-strip fill: writes the pair 0x34,0x36 to the
// VRAM cursor HL, B times, advancing by 2. Saves the advanced cursor back to (0x400b), exx-restores HL to
// the 0x4008 counter, and decrements it: returns while the counter is still non-zero, else falls into the
// 0x4009 branch (loc_1d51). Data-dependent T-total; entry contract is B=0x10.
export function loc_1d43(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1d43:
    mem.write8(regs.hl, 0x34); // tile code 0x34 -> VRAM
    m.step(0x1d45, 10);

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1d46, 6);

    mem.write8(regs.hl, 0x36); // tile code 0x36 -> VRAM
    m.step(0x1d48, 10);

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1d49, 6);

    if (regs.djnz() !== 0) {
      m.step(0x1d43, 13); // djnz (taken)
      continue;
    }
    m.step(0x1d4b, 8); // djnz (not taken)
    break;
  }

  mem.write16(0x400b, regs.hl);
  m.step(0x1d4e, 16); // stash advanced VRAM cursor back to 0x400b

  regs.exx();
  m.step(0x1d4f, 4); // restore MAIN HL = 0x4008 counter pointer

  regs.decMem8(mem, regs.hl);
  m.step(0x1d50, 11); // dec (0x4008) -- strip-redraw countdown

  if (regs.fNZ) {
    // ret nz (taken) -- counter still running
    m.ret(11);
    return;
  }
  m.step(0x1d51, 5); // ret nz (not taken)

  // fall-through into loc_1d51
  return m.call(0x1d51);
}

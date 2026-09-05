// SPDX-License-Identifier: GPL-3.0-only

// loc_207d  (ROM 0x207d-0x2088) — one slot of the loc_2067 loop. Save BC/HL, A=L (slot index arg). If bit 0
// of the slot flag (HL) is set, tail into loc_2089 (the active-slot handler). Otherwise call 0x205e, then the
// hidden jr at 0x2087 (0x18 0x0b) delegates to loc_2094 -- the shared epilogue (pop/advance/djnz), a
// second-entry into loc_2089's tail with its own registered file.
export function loc_207d(m) {
  const { regs, mem } = m;

  m.push16(regs.bc);
  m.step(0x207e, 11); // push bc -- stride+count saved across the slot

  m.push16(regs.hl);
  m.step(0x207f, 11); // push hl -- slot pointer saved across the slot

  regs.a = regs.l;
  m.step(0x2080, 4); // ld a,l -- slot index passed in A

  regs.bit(0, mem.read8(regs.hl));
  m.step(0x2082, 12); // bit 0,(hl) -- slot active?

  if (regs.fNZ) {
    m.step(0x2089, 12); // jr nz,0x2089 (taken) -- active slot
    return m.call(0x2089);
  }
  m.step(0x2084, 7); // jr nz,0x2089 (not taken)

  // call 0x205e
  m.push16(0x2087);
  m.step(0x205e, 17);
  m.call(0x205e);

  m.step(0x2094, 12); // 0x2087 jr 0x2094 -- rejoin the shared epilogue at loc_2094 (its own second-entry file)
  return m.call(0x2094);
}

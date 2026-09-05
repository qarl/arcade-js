// SPDX-License-Identifier: GPL-3.0-only

// loc_17e5  (ROM 0x17e5-0x17f8, falls through into loc_17f9) — returns if (0x4226) bit0 set; else bumps HL,
// and if (0x425f) bit0 set tail-jumps to loc_1801; otherwise, while counter (0x41c4) < 0x60, inc's (hl),
// then falls through to loc_17f9.
export function loc_17e5(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4226); // gate flag
  m.step(0x17e8, 13);

  regs.rrca(); // bit0 -> carry
  m.step(0x17e9, 4);

  if (regs.fC) {
    // ret c (taken) -- bit0 set
    m.ret(11);
    return;
  }
  m.step(0x17ea, 5); // ret c (not taken)

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x17eb, 6);

  regs.a = mem.read8(0x425f); // gate flag
  m.step(0x17ee, 13);

  regs.rrca(); // bit0 -> carry
  m.step(0x17ef, 4);

  if (regs.fC) {
    // jr c,0x1801 (taken) -- tail to loc_1801
    m.step(0x1801, 12);
    return m.call(0x1801);
  }
  m.step(0x17f1, 7); // jr c,0x1801 (not taken)

  regs.a = mem.read8(0x41c4); // counter
  m.step(0x17f4, 13);

  regs.cp(0x60);
  m.step(0x17f6, 7);

  if (regs.fNC) {
    // jr nc,0x17f9 (taken) -- counter >= 0x60: skip inc, fall into loc_17f9
    m.step(0x17f9, 12);
    return m.call(0x17f9);
  }
  m.step(0x17f8, 7); // jr nc,0x17f9 (not taken)

  regs.incMem8(mem, regs.hl); // inc (hl)
  m.step(0x17f9, 11);

  // fall-through into loc_17f9 -- separate routine, delegate
  return m.call(0x17f9);
}

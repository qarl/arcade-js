// SPDX-License-Identifier: GPL-3.0-only

// loc_180c  (ROM 0x180c-0x1814) — recompute a sound byte from work-RAM 0x41c4, keyed on the carry rrca
// leaves from the incoming A's bit0, then fall through to loc_1815 which stores the result to 0x41c1.
export function loc_180c(m) {
  const { regs, mem } = m;

  regs.rrca();
  m.step(0x180d, 4); // carry = incoming A bit0; the ld below reloads A, so only the carry survives

  regs.a = mem.read8(0x41c4); // 0x41c4: sound work-RAM cell (ld leaves the carry intact)
  m.step(0x1810, 13);

  if (regs.fNC) {
    // jr nc,0x1815 (taken) -- bit0 was 0: store 0x41c4 unchanged
    m.step(0x1815, 12);
    return m.call(0x1815);
  }
  m.step(0x1812, 7); // jr nc,0x1815 (not taken)

  regs.add(0x60);
  m.step(0x1814, 7);

  regs.rra();
  m.step(0x1815, 4);

  // fall-through into loc_1815 (store A -> 0x41c1) -- separate routine, delegate
  return m.call(0x1815);
}

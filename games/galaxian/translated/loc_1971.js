// SPDX-License-Identifier: GPL-3.0-only

// loc_1971  (ROM 0x1971-0x1973) — set the 0x4001 flag to 1 (bit0 set), return.
export function loc_1971(m) {
  const { regs, mem } = m;

  mem.write8(regs.hl, 0x01);
  m.step(0x1973, 10); // ld (hl),0x01

  return m.ret();
}

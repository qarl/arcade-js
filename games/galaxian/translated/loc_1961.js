// SPDX-License-Identifier: GPL-3.0-only

// loc_1961  (ROM 0x1961-0x1963) — clamp helper: force the 0x40xx counter at HL to its 0x63 ceiling, return.
export function loc_1961(m) {
  const { regs, mem } = m;

  mem.write8(regs.hl, 0x63);
  m.step(0x1963, 10); // ld (hl),0x63

  return m.ret();
}

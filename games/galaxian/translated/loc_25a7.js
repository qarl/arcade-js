// SPDX-License-Identifier: GPL-3.0-only

// loc_25a7  (ROM 0x25a7-0x25a8) — seeds A=0x2c then falls through into loc_25a9, which writes a vertical
// tile pair (codes 0x2c and 0x2e, 0x20 apart) at (HL).
export function loc_25a7(m) {
  const { regs } = m;

  regs.a = 0x2c;
  m.step(0x25a9, 7); // ld a,0x2c -- starting tile code

  // fall-through into loc_25a9 -- separate routine, delegate
  return m.call(0x25a9);
}

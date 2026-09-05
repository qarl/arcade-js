// SPDX-License-Identifier: GPL-3.0-only

// loc_259e  (ROM 0x259e-0x259f) — enter loc_25a0 (draw one horizontal tile pair) with tile seed A=0x2c.
export function loc_259e(m) {
  const { regs } = m;

  regs.a = 0x2c;
  m.step(0x25a0, 7); // ld a,0x2c -- tile seed

  // fall-through into loc_25a0 -- genuine routine, delegate
  return m.call(0x25a0);
}

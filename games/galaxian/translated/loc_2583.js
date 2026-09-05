// SPDX-License-Identifier: GPL-3.0-only

// loc_2583  (ROM 0x2583-0x2584) — seeds A=0x2c (first tile code) then falls through into loc_2585, the
// 2x2 tile-block writer, which lays down codes 0x2c..0x2f at (HL).
export function loc_2583(m) {
  const { regs } = m;

  regs.a = 0x2c;
  m.step(0x2585, 7); // ld a,0x2c -- starting tile code

  // fall-through into loc_2585 -- separate routine, delegate
  return m.call(0x2585);
}

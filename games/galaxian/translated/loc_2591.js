// SPDX-License-Identifier: GPL-3.0-only

// loc_2591  (ROM 0x2591-0x2592) — enter loc_2593 (draw a 2x2 tile block upward) with tile seed A=0x2e.
export function loc_2591(m) {
  const { regs } = m;

  regs.a = 0x2e;
  m.step(0x2593, 7); // ld a,0x2e -- tile seed

  // fall-through into loc_2593 -- genuine routine, delegate
  return m.call(0x2593);
}

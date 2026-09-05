// SPDX-License-Identifier: GPL-3.0-only

// loc_18e7  (ROM 0x18e7) — one instruction: restore the countdown pointer from DE (stashed by loc_18c0),
// then fall through into loc_18e8 to decrement it.
export function loc_18e7(m) {
  const { regs } = m;

  regs.exDeHl();
  m.step(0x18e8, 4); // ex de,hl -- HL = countdown pointer

  // fall-through into loc_18e8 (dec the countdown byte)
  return m.call(0x18e8);
}

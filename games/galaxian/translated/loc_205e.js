// SPDX-License-Identifier: GPL-3.0-only

// loc_205e  (ROM 0x205e-0x2066) — call 0x20e1, then branch on its carry result: carry -> tail-jp 0x2583,
// no-carry -> tail-jp 0x25a7.
export function loc_205e(m) {
  const { regs } = m;

  // call 0x20e1
  m.push16(0x2061);
  m.step(0x20e1, 17);
  m.call(0x20e1);

  if (regs.fC) {
    m.step(0x2583, 10); // jp c,0x2583 (taken)
    return m.call(0x2583);
  }
  m.step(0x2064, 10); // jp c,0x2583 (not taken; jp cc = 10 T either way)

  m.step(0x25a7, 10); // jp 0x25a7 -- unconditional tail
  return m.call(0x25a7);
}

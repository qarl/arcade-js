// SPDX-License-Identifier: GPL-3.0-only

// loc_01be  (ROM 0x01be-0x01c5) — sub-state handler (rst-0x28 target @0x0166): set (0x4019)=1, then
// tail-jump to 0x0336.
export function loc_01be(m) {
  const { regs, mem } = m;

  regs.a = 0x01;
  m.step(0x01c0, 7);

  mem.write8(0x4019, regs.a);
  m.step(0x01c3, 13);

  m.step(0x0336, 10);
  return m.call(0x0336);
}

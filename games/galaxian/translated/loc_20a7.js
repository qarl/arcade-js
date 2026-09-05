// SPDX-License-Identifier: GPL-3.0-only

// loc_20a7  (ROM 0x20a7-0x20ab) — read the saved value at work-RAM 0x40ab; ret if it is zero, else fall
// through into loc_20ac.
export function loc_20a7(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x40ab);
  m.step(0x20aa, 13); // ld a,(0x40ab) -- saved value

  regs.and(regs.a);
  m.step(0x20ab, 4); // and a -- test A

  if (regs.fZ) {
    m.ret(11); // ret z (taken)
    return;
  }
  m.step(0x20ac, 5); // ret z (not taken)

  // fall through into loc_20ac -- separate head, delegate
  return m.call(0x20ac);
}

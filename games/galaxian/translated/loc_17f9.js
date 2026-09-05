// SPDX-License-Identifier: GPL-3.0-only

// loc_17f9  (ROM 0x17f9-0x1800, falls through into loc_1801) — tests A: if zero, tail-jumps to loc_1801;
// else decrements A, stores it back to counter (0x41c4), then falls through to loc_1801.
export function loc_17f9(m) {
  const { regs, mem } = m;

  regs.and(regs.a); // test A: Z, clears carry
  m.step(0x17fa, 4);

  if (regs.fZ) {
    // jp z,0x1801 (taken) -- tail to loc_1801
    m.step(0x1801, 10);
    return m.call(0x1801);
  }
  m.step(0x17fd, 10); // jp z,0x1801 (not taken)

  regs.a = regs.dec8(regs.a);
  m.step(0x17fe, 4);

  mem.write8(0x41c4, regs.a); // counter
  m.step(0x1801, 13);

  // fall-through into loc_1801 -- separate routine, delegate
  return m.call(0x1801);
}

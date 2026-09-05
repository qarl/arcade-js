// SPDX-License-Identifier: GPL-3.0-only

// loc_1c50  (ROM 0x1C50-0x1C5C) — reads IN1 (0x6800) into C; if either low bit is set, seed control
// byte (0x41DF)=0x16, then falls through into loc_1c5d. B (=IN0 from the caller) and C are consumed downstream.
export function loc_1c50(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6800);
  m.step(0x1c53, 13); // ld a,(0x6800) -- IN1

  regs.c = regs.a;
  m.step(0x1c54, 4); // ld c,a -- keep full IN1 for the or c tests downstream

  regs.and(0x03);
  m.step(0x1c56, 7); // and 0x03 -- Z iff neither low bit set

  if (regs.fZ) {
    m.step(0x1c5d, 12);
    return m.call(0x1c5d);
  }
  m.step(0x1c58, 7);

  regs.a = 0x16;
  m.step(0x1c5a, 7);

  mem.write8(0x41df, regs.a);
  m.step(0x1c5d, 13); // ld (0x41df),a -- control byte

  // fall-through into loc_1c5d -- delegate, do not inline
  return m.call(0x1c5d);
}

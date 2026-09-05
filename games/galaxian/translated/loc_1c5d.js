// SPDX-License-Identifier: GPL-3.0-only

// loc_1c5d  (ROM 0x1C5D-0x1C67) — tests (IN0|IN1) bits 2-3 (B=IN0, C=IN1); if either is set, seed
// control byte (0x41DF)=0x06, then falls through into loc_1c68.
export function loc_1c5d(m) {
  const { regs, mem } = m;

  regs.a = regs.b;
  m.step(0x1c5e, 4); // ld a,b -- IN0

  regs.or(regs.c);
  m.step(0x1c5f, 4); // or c -- IN0 | IN1

  regs.and(0x0c);
  m.step(0x1c61, 7); // and 0x0c -- Z iff neither bit 2/3 set

  if (regs.fZ) {
    m.step(0x1c68, 12);
    return m.call(0x1c68);
  }
  m.step(0x1c63, 7);

  regs.a = 0x06;
  m.step(0x1c65, 7);

  mem.write8(0x41df, regs.a);
  m.step(0x1c68, 13); // ld (0x41df),a -- control byte

  // fall-through into loc_1c68 -- delegate, do not inline
  return m.call(0x1c68);
}

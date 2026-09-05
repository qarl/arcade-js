// SPDX-License-Identifier: GPL-3.0-only

// loc_1c68  (ROM 0x1C68-0x1C72) — continues the input scan. Tests (IN0|IN1) bit 4 (B=IN0, C=IN1); if
// set, seed control byte (0x41CC)=0x01, then falls through into loc_1c73. Consumes B and C as live regs.
//   1c68  78        ld a,b          ; A = IN0
//   1c69  b1        or c            ; A = IN0 | IN1
//   1c6a  e6 10     and 0x10
//   1c6c  28 05     jr z,0x1c73
//   1c6e  3e 01     ld a,0x01
//   1c70  32 cc 41  ld (0x41cc),a
//   (falls through into loc_1c73)
export function loc_1c68(m) {
  const { regs, mem } = m;

  regs.a = regs.b;
  m.step(0x1c69, 4); // ld a,b -- IN0

  regs.or(regs.c);
  m.step(0x1c6a, 4); // or c -- IN0 | IN1

  regs.and(0x10);
  m.step(0x1c6c, 7); // and 0x10 -- Z iff bit 4 clear

  if (regs.fZ) {
    m.step(0x1c73, 12); // jr z,0x1c73 (taken)
    return m.call(0x1c73);
  }
  m.step(0x1c6e, 7); // jr z,0x1c73 (not taken)

  regs.a = 0x01;
  m.step(0x1c70, 7); // ld a,0x01

  mem.write8(0x41cc, regs.a);
  m.step(0x1c73, 13); // ld (0x41cc),a -- control byte

  // fall-through into loc_1c73 -- delegate, do not inline
  return m.call(0x1c73);
}

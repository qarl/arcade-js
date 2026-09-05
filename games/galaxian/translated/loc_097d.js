// SPDX-License-Identifier: GPL-3.0-only

// loc_097d  (ROM 0x097d-0x0982) — set direction flag (jr target from loc_090d's 0x0951): (0x420d) <- 1; ret.
// Companion of loc_0983 which clears the same cell.
export function loc_097d(m) {
  const { regs, mem } = m;

  regs.a = 0x01;
  m.step(0x097f, 7); // ld a,0x01

  mem.write8(0x420d, regs.a); // ld (0x420d),a -- direction flag <- 1
  m.step(0x0982, 13);

  m.ret();
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_0983  (ROM 0x0983-0x0987) — clear the 0x420d flag cell (work RAM) and return.
export function loc_0983(m) {
  const { regs, mem } = m;

  regs.xor(regs.a);
  m.step(0x0984, 4); // xor a -- A=0

  mem.write8(0x420d, regs.a);
  m.step(0x0987, 13); // ld (0x420d),a -- flag <- 0

  m.ret();
}

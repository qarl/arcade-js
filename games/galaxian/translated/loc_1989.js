// SPDX-License-Identifier: GPL-3.0-only

// loc_1989  (ROM 0x1989-0x198d) — clear the 0x6002 latch (coin_lock D0 on the galaxian board) to 0, ret.
// Also the >=9 tail target of loc_197c.
export function loc_1989(m) {
  const { regs, mem } = m;

  regs.xor(regs.a); // A=0
  m.step(0x198a, 4);

  mem.write8(0x6002, regs.a, 10); // 0x6002 latch (coin_lock D0) = 0; busOffset 10
  m.step(0x198d, 13);

  return m.ret();
}

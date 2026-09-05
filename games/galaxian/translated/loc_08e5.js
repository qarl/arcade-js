// SPDX-License-Identifier: GPL-3.0-only

// loc_08e5  (ROM 0x08e5-0x08f1) — called from 0x067f. If flag (0x420b) bit0 is set, clear both the flag
// (0x420b) and the gate (0x4208); otherwise ret with nothing done.
export function loc_08e5(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x420b);
  m.step(0x08e8, 13); // ld a,(0x420b) -- flag

  regs.rrca();
  m.step(0x08e9, 4); // rrca -- carry = bit0 of (0x420b)

  if (regs.fNC) { m.ret(11); return; } // ret nc -- flag clear: nothing to do
  m.step(0x08ea, 5); // ret nc (not taken)

  regs.xor(regs.a);
  m.step(0x08eb, 4); // xor a -- A=0

  mem.write8(0x420b, regs.a);
  m.step(0x08ee, 13); // ld (0x420b),a -- clear flag

  mem.write8(0x4208, regs.a);
  m.step(0x08f1, 13); // ld (0x4208),a -- clear gate

  m.ret();
}

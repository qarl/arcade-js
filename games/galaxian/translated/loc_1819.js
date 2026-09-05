// SPDX-License-Identifier: GPL-3.0-only

// loc_1819  (ROM 0x1819-0x1839) — sound-driver updater: gated by bit0 of 0x4006 (return if clear); then
// dispatches on 0x41df — !=6 tails to loc_183a, ==6 and 0x41cd bit0 clear arms a sound sequence
// (0x41cf=0x41d6=1, sequence pointer 0x41d3=0x1ebd).
export function loc_1819(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4006);
  m.step(0x181c, 13);

  regs.rrca();
  m.step(0x181d, 4); // carry = 0x4006 bit0

  if (regs.fNC) {
    m.ret(11); // ret nc (taken) -- gate closed
    return;
  }
  m.step(0x181e, 5); // ret nc (not taken)

  regs.a = mem.read8(0x41df); // 0x41df: sequence selector
  m.step(0x1821, 13);

  regs.cp(0x06);
  m.step(0x1823, 7);

  if (regs.fNZ) {
    // jp nz,0x183a (taken) -- selector != 6: alternate arm
    m.step(0x183a, 10);
    return m.call(0x183a);
  }
  m.step(0x1826, 10); // jp nz,0x183a (not taken)

  regs.a = mem.read8(0x41cd); // 0x41cd: sequence-active flag
  m.step(0x1829, 13);

  regs.rrca();
  m.step(0x182a, 4); // carry = 0x41cd bit0

  if (regs.fC) {
    m.ret(11); // ret c (taken) -- already active
    return;
  }
  m.step(0x182b, 5); // ret c (not taken)

  regs.a = 0x01;
  m.step(0x182d, 7);

  mem.write8(0x41cf, regs.a); // 0x41cf = 1
  m.step(0x1830, 13);

  mem.write8(0x41d6, regs.a); // 0x41d6 = 1
  m.step(0x1833, 13);

  regs.hl = 0x1ebd;
  m.step(0x1836, 10);

  mem.write16(0x41d3, regs.hl); // 0x41d3 = sequence data pointer 0x1ebd
  m.step(0x1839, 16);

  return m.ret();
}

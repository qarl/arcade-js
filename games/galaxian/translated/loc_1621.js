// SPDX-License-Identifier: GPL-3.0-only

// loc_1621  (ROM 0x1621-0x1636) — gated one-shot: return early unless bit0 of (0x4220) AND (0x4225) are set
// and bit0 of (0x4222) is clear; when all pass, set the (0x4222) word to 1 (arm the flag) and ret.
export function loc_1621(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4220);
  m.step(0x1624, 13); // ld a,(0x4220)

  regs.rrca();
  m.step(0x1625, 4); // rrca -- carry = bit0

  if (regs.fNC) {
    m.ret(11); // ret nc (taken) -- (0x4220) bit0 clear
    return;
  }
  m.step(0x1626, 5); // ret nc (not taken)

  regs.a = mem.read8(0x4225);
  m.step(0x1629, 13); // ld a,(0x4225)

  regs.rrca();
  m.step(0x162a, 4); // rrca -- carry = bit0

  if (regs.fNC) {
    m.ret(11); // ret nc (taken) -- (0x4225) bit0 clear
    return;
  }
  m.step(0x162b, 5); // ret nc (not taken)

  regs.a = mem.read8(0x4222);
  m.step(0x162e, 13); // ld a,(0x4222)

  regs.rrca();
  m.step(0x162f, 4); // rrca -- carry = bit0

  if (regs.fC) {
    m.ret(11); // ret c (taken) -- already armed
    return;
  }
  m.step(0x1630, 5); // ret c (not taken)

  regs.hl = 0x0001;
  m.step(0x1633, 10); // ld hl,0x0001

  mem.write16(0x4222, regs.hl);
  m.step(0x1636, 16); // ld (0x4222),hl -- arm the flag word

  m.ret();
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_0008  (ROM 0x0008-0x000F) — RST 08 vector: a conditional DOUBLE-RETURN. Reads flag byte (0x4007),
// rotates bit0 into carry; bit0=0 returns normally, bit0=1 does `inc sp` twice to discard the caller's own
// return slot so control lands TWO levels up (a caller-skip idiom).
export function loc_0008(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4007);
  m.step(0x000b, 13); // ld a,(0x4007)

  regs.rrca();
  m.step(0x000c, 4); // rrca -- carry = bit0 of (0x4007)

  if (regs.fNC) {
    m.ret(11); // ret nc (taken) -- normal return
    return;
  }
  m.step(0x000d, 5); // ret nc (not taken)

  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x000e, 6); // inc sp

  regs.sp = (regs.sp + 1) & 0xffff;
  m.step(0x000f, 6); // inc sp -- SP now past the caller's return slot

  m.ret(); // ret -- returns two levels up (caller's own return was skipped)
}

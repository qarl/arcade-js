// SPDX-License-Identifier: GPL-3.0-only

// loc_10f0  (ROM 0x10f0-0x1111) — sub-state 0: init fields +0x10=4, +0x11=4, +0x12=0x1c, advance state
// (inc +0x02), then set (0x41df) from field +0x07: 0x07 when +0x07 < 0x70, else 0x17 (interior loc_110c).
// rst-0x28 dispatch target from loc_10e4's table.
export function loc_10f0(m) {
  const { regs, mem } = m;

  mem.write8((regs.ix + 0x10) & 0xffff, 0x04);
  m.step(0x10f4, 19); // ld (ix+0x10),0x04

  mem.write8((regs.ix + 0x11) & 0xffff, 0x04);
  m.step(0x10f8, 19); // ld (ix+0x11),0x04

  mem.write8((regs.ix + 0x12) & 0xffff, 0x1c);
  m.step(0x10fc, 19); // ld (ix+0x12),0x1c

  regs.incMem8(mem, (regs.ix + 0x02) & 0xffff);
  m.step(0x10ff, 23); // inc (ix+0x02) -- advance sub-state

  regs.a = mem.read8((regs.ix + 0x07) & 0xffff);
  m.step(0x1102, 19); // ld a,(ix+0x07)

  regs.cp(0x70);
  m.step(0x1104, 7); // cp 0x70

  if (regs.fNC) {
    // jr nc,0x110c (taken) -- loc_110c: +0x07 >= 0x70
    m.step(0x110c, 12);

    regs.a = 0x17;
    m.step(0x110e, 7); // ld a,0x17

    mem.write8(0x41df, regs.a); // (0x41df) work RAM
    m.step(0x1111, 13); // ld (0x41df),a

    m.ret();
    return;
  }
  m.step(0x1106, 7); // jr nc,0x110c (not taken)

  regs.a = 0x07;
  m.step(0x1108, 7); // ld a,0x07

  mem.write8(0x41df, regs.a); // (0x41df) work RAM
  m.step(0x110b, 13); // ld (0x41df),a

  m.ret();
}

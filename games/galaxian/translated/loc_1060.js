// SPDX-License-Identifier: GPL-3.0-only

// loc_1060  (ROM 0x1060-0x108d) — ascending path-walk variant, and the current handler stored in the
// object pointer word (0x4008). Entered from loc_101f's bit0-set branch (HL already = 0x1e00+cursor) or
// via the 0x4008 vector: ADDS the step-table byte to Y (ix+0x04), advances the cursor (ix+0x13), then
// ticks the move throttle (ix+0x10) and leg counter (ix+0x11); on leg expiry it advances the state
// (ix+0x02), reloads throttle/leg, sets (ix+0x05)=0xf4 and resets the cursor.
export function loc_1060(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(regs.ix + 0x04);
  m.step(0x1063, 19); // ld a,(ix+0x04)
  regs.add(mem.read8(regs.hl));
  m.step(0x1064, 7); // add a,(hl) -- Y delta from step table
  mem.write8(regs.ix + 0x04, regs.a);
  m.step(0x1067, 19); // (ix+0x04) = new Y
  regs.l = regs.inc8(regs.l);
  m.step(0x1068, 4); // inc l
  mem.write8(regs.ix + 0x13, regs.l);
  m.step(0x106b, 19); // (ix+0x13) = advanced cursor

  regs.decMem8(mem, regs.ix + 0x10);
  m.step(0x106e, 23); // dec (ix+0x10) -- move throttle
  if (regs.fNZ) {
    m.ret(11); // ret nz -- throttle not expired
    return;
  }
  m.step(0x106f, 5);

  mem.write8(regs.ix + 0x10, 0x04);
  m.step(0x1073, 19); // (ix+0x10) = throttle reload
  regs.incMem8(mem, regs.ix + 0x05);
  m.step(0x1076, 23); // inc (ix+0x05)
  regs.decMem8(mem, regs.ix + 0x11);
  m.step(0x1079, 23); // dec (ix+0x11) -- leg counter (sets Z)
  if (regs.fNZ) {
    m.ret(11); // ret nz -- leg not finished
    return;
  }
  m.step(0x107a, 5);

  regs.incMem8(mem, regs.ix + 0x02);
  m.step(0x107d, 23); // inc (ix+0x02) -- advance state
  mem.write8(regs.ix + 0x10, 0x03);
  m.step(0x1081, 19); // (ix+0x10) = 3
  mem.write8(regs.ix + 0x11, 0x0c);
  m.step(0x1085, 19); // (ix+0x11) = 0x0c
  mem.write8(regs.ix + 0x05, 0xf4);
  m.step(0x1089, 19); // (ix+0x05) = 0xf4
  mem.write8(regs.ix + 0x13, 0x00);
  m.step(0x108d, 19); // (ix+0x13) = 0 -- cursor reset

  m.ret();
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_101f  (ROM 0x101f-0x105f) — path-walk state handler (dispatch-table entry @0x0cfa). Reads the
// step-table cursor (ix+0x13) into HL=0x1e00+cursor, subtracts the table byte from X (ix+0x03), and —
// when (ix+0x06) bit0 is clear — also subtracts the next byte from Y (ix+0x04), advancing the cursor.
// Then ticks the move throttle (ix+0x10) and the leg counter (ix+0x11); on leg expiry it advances the
// state (ix+0x02), reloads the throttle/leg counts, sets (ix+0x05)=0x0c and resets the cursor.
// bit0 set tail-branches to loc_1060 (the mirrored ascending variant).
export function loc_101f(m) {
  const { regs, mem } = m;

  regs.l = mem.read8(regs.ix + 0x13);
  m.step(0x1022, 19); // ld l,(ix+0x13) -- step-table cursor
  regs.h = 0x1e;
  m.step(0x1024, 7); // HL = 0x1e00 + cursor (step table in ROM)

  regs.a = mem.read8(regs.ix + 0x03);
  m.step(0x1027, 19); // ld a,(ix+0x03)
  regs.sub(mem.read8(regs.hl));
  m.step(0x1028, 7); // sub (hl) -- X delta from table
  mem.write8(regs.ix + 0x03, regs.a);
  m.step(0x102b, 19); // (ix+0x03) = new X
  regs.l = regs.inc8(regs.l);
  m.step(0x102c, 4); // inc l -- cursor -> Y-delta byte

  const ea = (regs.ix + 0x06) & 0xffff;
  regs.bit(0, mem.read8(ea), ea >> 8);
  m.step(0x1030, 20); // bit 0,(ix+0x06) -- direction flag
  if (regs.fNZ) {
    m.step(0x1060, 12); // jr nz,0x1060 -- ascending variant
    return m.call(0x1060);
  }
  m.step(0x1032, 7);

  regs.a = mem.read8(regs.ix + 0x04);
  m.step(0x1035, 19); // ld a,(ix+0x04)
  regs.sub(mem.read8(regs.hl));
  m.step(0x1036, 7); // sub (hl) -- Y delta from table
  mem.write8(regs.ix + 0x04, regs.a);
  m.step(0x1039, 19); // (ix+0x04) = new Y
  regs.l = regs.inc8(regs.l);
  m.step(0x103a, 4); // inc l
  mem.write8(regs.ix + 0x13, regs.l);
  m.step(0x103d, 19); // (ix+0x13) = advanced cursor

  regs.decMem8(mem, regs.ix + 0x10);
  m.step(0x1040, 23); // dec (ix+0x10) -- move throttle
  if (regs.fNZ) {
    m.ret(11); // ret nz -- throttle not expired
    return;
  }
  m.step(0x1041, 5);

  mem.write8(regs.ix + 0x10, 0x04);
  m.step(0x1045, 19); // (ix+0x10) = throttle reload
  regs.decMem8(mem, regs.ix + 0x05);
  m.step(0x1048, 23); // dec (ix+0x05)
  regs.decMem8(mem, regs.ix + 0x11);
  m.step(0x104b, 23); // dec (ix+0x11) -- leg counter (sets Z)
  if (regs.fNZ) {
    m.ret(11); // ret nz -- leg not finished
    return;
  }
  m.step(0x104c, 5);

  regs.incMem8(mem, regs.ix + 0x02);
  m.step(0x104f, 23); // inc (ix+0x02) -- advance state
  mem.write8(regs.ix + 0x10, 0x03);
  m.step(0x1053, 19); // (ix+0x10) = 3
  mem.write8(regs.ix + 0x11, 0x0c);
  m.step(0x1057, 19); // (ix+0x11) = 0x0c
  mem.write8(regs.ix + 0x05, 0x0c);
  m.step(0x105b, 19); // (ix+0x05) = 0x0c
  mem.write8(regs.ix + 0x13, 0x00);
  m.step(0x105f, 19); // (ix+0x13) = 0 -- cursor reset

  m.ret();
}

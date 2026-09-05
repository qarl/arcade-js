// SPDX-License-Identifier: GPL-3.0-only

// loc_0c20  (ROM 0x0c20-0x0cc2) — build one hardware sprite record at IY (4-byte: +0 Y, +1 code/attr,
// +2 sprite#, +3 X) from object struct IX. +0 active: copy fields (X=(ix+3)-8, Y=~(ix+4)-C) then fold the
// signed angle (ix+5) into a display attr, looping ±0x18 until it lands in a range. +0 clear/+1 active: a
// fixed variant (+2=7, attr=(ix+0x12)). Both clear: park the sprite off-screen (Y=X=0xf8).
export function loc_0c20(m) {
  const { regs, mem } = m;

  regs.bit(0, mem.read8((regs.ix + 0x00) & 0xffff));
  m.step(0x0c24, 20); // bit 0,(ix+0)

  if (regs.fZ) {
    m.step(0x0c98, 10); // jp z,0x0c98 (taken) -- +0 inactive

    regs.bit(0, mem.read8((regs.ix + 0x01) & 0xffff));
    m.step(0x0c9c, 20); // bit 0,(ix+1)

    if (regs.fZ) {
      m.step(0x0cba, 10); // jp z,0x0cba (taken)
      mem.write8((regs.iy + 0x03) & 0xffff, 0xf8); // X off-screen
      m.step(0x0cbe, 19);
      mem.write8((regs.iy + 0x00) & 0xffff, 0xf8); // Y off-screen
      m.step(0x0cc2, 19);
      m.ret();
      return;
    }
    m.step(0x0c9f, 10); // jp z,0x0cba (not taken)

    mem.write8((regs.iy + 0x02) & 0xffff, 0x07); // sprite#
    m.step(0x0ca3, 19);
    regs.a = mem.read8((regs.ix + 0x03) & 0xffff);
    m.step(0x0ca6, 19);
    regs.sub(0x08);
    m.step(0x0ca8, 7);
    mem.write8((regs.iy + 0x03) & 0xffff, regs.a); // X
    m.step(0x0cab, 19);
    regs.a = mem.read8((regs.ix + 0x04) & 0xffff);
    m.step(0x0cae, 19);
    regs.cpl();
    m.step(0x0caf, 4);
    regs.sub(regs.c);
    m.step(0x0cb0, 4);
    mem.write8((regs.iy + 0x00) & 0xffff, regs.a); // Y
    m.step(0x0cb3, 19);
    regs.a = mem.read8((regs.ix + 0x12) & 0xffff);
    m.step(0x0cb6, 19);
    mem.write8((regs.iy + 0x01) & 0xffff, regs.a); // code/attr
    m.step(0x0cb9, 19);
    m.ret();
    return;
  }
  m.step(0x0c27, 10); // jp z,0x0c98 (not taken)

  regs.a = mem.read8((regs.ix + 0x16) & 0xffff);
  m.step(0x0c2a, 19);
  mem.write8((regs.iy + 0x02) & 0xffff, regs.a); // sprite#
  m.step(0x0c2d, 19);
  regs.a = mem.read8((regs.ix + 0x03) & 0xffff);
  m.step(0x0c30, 19);
  regs.sub(0x08);
  m.step(0x0c32, 7);
  mem.write8((regs.iy + 0x03) & 0xffff, regs.a); // X
  m.step(0x0c35, 19);
  regs.a = mem.read8((regs.ix + 0x04) & 0xffff);
  m.step(0x0c38, 19);
  regs.cpl();
  m.step(0x0c39, 4);
  regs.sub(regs.c);
  m.step(0x0c3a, 4);
  mem.write8((regs.iy + 0x00) & 0xffff, regs.a); // Y
  m.step(0x0c3d, 19);
  regs.a = mem.read8((regs.ix + 0x05) & 0xffff);
  m.step(0x0c40, 19); // A = signed angle

  for (;;) {
    // loc_0c40: fold A into a display range
    regs.and(regs.a);
    m.step(0x0c41, 4);

    if (regs.fP) {
      m.step(0x0c58, 10); // jp p,0x0c58 (taken) -- A >= 0

      regs.cp(0x06);
      m.step(0x0c5a, 7);
      if (regs.fP) {
        m.step(0x0c6e, 10); // jp p,0x0c6e (taken) -- A >= 6

        regs.cp(0x0c);
        m.step(0x0c70, 7);
        if (regs.fP) {
          m.step(0x0c90, 10); // jp p,0x0c90 (taken) -- A >= 0x0c: subtract a turn
          regs.sub(0x18);
          m.step(0x0c92, 7);
          m.step(0x0c40, 12); // jr 0x0c40
          continue;
        }
        m.step(0x0c73, 10); // jp p,0x0c90 (not taken)
        regs.cpl();
        m.step(0x0c74, 4);
        regs.add(0x1e);
        m.step(0x0c76, 7);
        regs.or(0x80);
        m.step(0x0c78, 7);
        regs.add(mem.read8((regs.ix + 0x0f) & 0xffff));
        m.step(0x0c7b, 19);
        mem.write8((regs.iy + 0x01) & 0xffff, regs.a); // code/attr
        m.step(0x0c7e, 19);
        regs.incMem8(mem, (regs.iy + 0x00) & 0xffff); // inc Y
        m.step(0x0c81, 23);
        m.ret();
        return;
      }
      m.step(0x0c5d, 10); // jp p,0x0c6e (not taken)
      regs.add(0x11);
      m.step(0x0c5f, 7);
      regs.or(0xc0);
      m.step(0x0c61, 7);
      regs.add(mem.read8((regs.ix + 0x0f) & 0xffff));
      m.step(0x0c64, 19);
      mem.write8((regs.iy + 0x01) & 0xffff, regs.a); // code/attr
      m.step(0x0c67, 19);
      regs.incMem8(mem, (regs.iy + 0x03) & 0xffff); // inc X
      m.step(0x0c6a, 23);
      regs.incMem8(mem, (regs.iy + 0x00) & 0xffff); // inc Y
      m.step(0x0c6d, 23);
      m.ret();
      return;
    }
    m.step(0x0c44, 10); // jp p,0x0c58 (not taken) -- A < 0

    regs.cp(0xfa);
    m.step(0x0c46, 7);
    if (regs.fM) {
      m.step(0x0c82, 10); // jp m,0x0c82 (taken) -- A < 0xfa

      regs.cp(0xf4);
      m.step(0x0c84, 7);
      if (regs.fM) {
        m.step(0x0c94, 10); // jp m,0x0c94 (taken) -- A < 0xf4: add a turn
        regs.add(0x18);
        m.step(0x0c96, 7);
        m.step(0x0c40, 12); // jr 0x0c40
        continue;
      }
      m.step(0x0c87, 10); // jp m,0x0c94 (not taken)
      regs.add(0x1d);
      m.step(0x0c89, 7);
      regs.add(mem.read8((regs.ix + 0x0f) & 0xffff));
      m.step(0x0c8c, 19);
      mem.write8((regs.iy + 0x01) & 0xffff, regs.a); // code/attr
      m.step(0x0c8f, 19);
      m.ret();
      return;
    }
    m.step(0x0c49, 10); // jp m,0x0c82 (not taken) -- A in 0xfa..0xff

    regs.cpl();
    m.step(0x0c4a, 4);
    regs.add(0x12);
    m.step(0x0c4c, 7);
    regs.or(0x40);
    m.step(0x0c4e, 7);
    regs.add(mem.read8((regs.ix + 0x0f) & 0xffff));
    m.step(0x0c51, 19);
    mem.write8((regs.iy + 0x01) & 0xffff, regs.a); // code/attr
    m.step(0x0c54, 19);
    regs.incMem8(mem, (regs.iy + 0x03) & 0xffff); // inc X
    m.step(0x0c57, 23);
    m.ret();
    return;
  }
}

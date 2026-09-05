// SPDX-License-Identifier: GPL-3.0-only

// loc_0d71  (ROM 0x0d71-0x0dd0) — object state 1 (move along path), a rst-28 dispatch target from loc_0cd6
// (also entered by jp from loc_108e). Reads Y/X deltas from the path table at 0x1e00 + cursor (ix+0x13),
// adds Y to (ix+3); then per (ix+6) bit0 either subtracts (loc_0da8) or adds the X delta to (ix+4). A
// display-bounds miss (X+7 < 0x0e) drops to state 5 (loc_0dcc). Otherwise steps the cursor and, when the
// step counter (ix+0x10) and leg counter (ix+0x11) both expire, adjusts (ix+5) and advances the state.
export function loc_0d71(m) {
  const { regs, mem } = m;

  regs.l = mem.read8((regs.ix + 0x13) & 0xffff);
  m.step(0x0d74, 19); // L = path cursor
  regs.h = 0x1e;
  m.step(0x0d76, 7); // HL -> path delta table
  regs.a = mem.read8((regs.ix + 0x03) & 0xffff);
  m.step(0x0d79, 19);
  regs.add(mem.read8(regs.hl));
  m.step(0x0d7a, 7); // += Y delta
  mem.write8((regs.ix + 0x03) & 0xffff, regs.a); // (ix+3) = Y
  m.step(0x0d7d, 19);
  regs.l = regs.inc8(regs.l);
  m.step(0x0d7e, 4);
  regs.bit(0, mem.read8((regs.ix + 0x06) & 0xffff));
  m.step(0x0d82, 20);

  if (regs.fNZ) {
    m.step(0x0da8, 12); // jr nz,0x0da8 (taken) -- X moves negative
    regs.a = mem.read8((regs.ix + 0x04) & 0xffff);
    m.step(0x0dab, 19);
    regs.sub(mem.read8(regs.hl));
    m.step(0x0dac, 7); // -= X delta
    mem.write8((regs.ix + 0x04) & 0xffff, regs.a); // (ix+4) = X
    m.step(0x0daf, 19);
    regs.add(0x07);
    m.step(0x0db1, 7);
    regs.cp(0x0e);
    m.step(0x0db3, 7);
    if (regs.fC) {
      m.step(0x0dcc, 12); // jr c,0x0dcc (taken) -- off screen
      mem.write8((regs.ix + 0x02) & 0xffff, 0x05);
      m.step(0x0dd0, 19); // state = 5
      m.ret();
      return;
    }
    m.step(0x0db5, 7); // jr c,0x0dcc (not taken)
    regs.l = regs.inc8(regs.l);
    m.step(0x0db6, 4);
    mem.write8((regs.ix + 0x13) & 0xffff, regs.l); // save cursor
    m.step(0x0db9, 19);
    regs.decMem8(mem, (regs.ix + 0x10) & 0xffff);
    m.step(0x0dbc, 23);
    if (regs.fNZ) {
      m.ret(11); // ret nz (taken)
      return;
    }
    m.step(0x0dbd, 5); // ret nz (not taken)
    mem.write8((regs.ix + 0x10) & 0xffff, 0x04);
    m.step(0x0dc1, 19);
    regs.incMem8(mem, (regs.ix + 0x05) & 0xffff);
    m.step(0x0dc4, 23);
    regs.decMem8(mem, (regs.ix + 0x11) & 0xffff);
    m.step(0x0dc7, 23);
    if (regs.fNZ) {
      m.ret(11); // ret nz (taken)
      return;
    }
    m.step(0x0dc8, 5); // ret nz (not taken)
    regs.incMem8(mem, (regs.ix + 0x02) & 0xffff); // advance state
    m.step(0x0dcb, 23);
    m.ret();
    return;
  }
  m.step(0x0d84, 7); // jr nz,0x0da8 (not taken) -- X moves positive

  regs.a = mem.read8((regs.ix + 0x04) & 0xffff);
  m.step(0x0d87, 19);
  regs.add(mem.read8(regs.hl));
  m.step(0x0d88, 7); // += X delta
  mem.write8((regs.ix + 0x04) & 0xffff, regs.a); // (ix+4) = X
  m.step(0x0d8b, 19);
  regs.add(0x07);
  m.step(0x0d8d, 7);
  regs.cp(0x0e);
  m.step(0x0d8f, 7);
  if (regs.fC) {
    m.step(0x0dcc, 12); // jr c,0x0dcc (taken) -- off screen
    mem.write8((regs.ix + 0x02) & 0xffff, 0x05);
    m.step(0x0dd0, 19); // state = 5
    m.ret();
    return;
  }
  m.step(0x0d91, 7); // jr c,0x0dcc (not taken)
  regs.l = regs.inc8(regs.l);
  m.step(0x0d92, 4);
  mem.write8((regs.ix + 0x13) & 0xffff, regs.l); // save cursor
  m.step(0x0d95, 19);
  regs.decMem8(mem, (regs.ix + 0x10) & 0xffff);
  m.step(0x0d98, 23);
  if (regs.fNZ) {
    m.ret(11); // ret nz (taken)
    return;
  }
  m.step(0x0d99, 5); // ret nz (not taken)
  mem.write8((regs.ix + 0x10) & 0xffff, 0x04);
  m.step(0x0d9d, 19);
  regs.decMem8(mem, (regs.ix + 0x05) & 0xffff);
  m.step(0x0da0, 23);
  regs.decMem8(mem, (regs.ix + 0x11) & 0xffff);
  m.step(0x0da3, 23);
  if (regs.fNZ) {
    m.ret(11); // ret nz (taken)
    return;
  }
  m.step(0x0da4, 5); // ret nz (not taken)
  regs.incMem8(mem, (regs.ix + 0x02) & 0xffff); // advance state
  m.step(0x0da7, 23);
  m.ret();
}

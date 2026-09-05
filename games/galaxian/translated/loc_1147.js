// SPDX-License-Identifier: GPL-3.0-only

// loc_1147  (ROM 0x1147-0x116a) — compute an object's sprite screen coordinates from the packed grid
// cell in (ix+0x07). Y (ix+0x03) = 0x7c - 3/4*(cell&0x70); X (ix+0x04) = (0x420e) + ((cell&0x0f)<<4) + 7.
export function loc_1147(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(regs.ix + 0x07); // packed cell index
  m.step(0x114a, 19);

  regs.and(0x70); // row bits (4-6)
  m.step(0x114c, 7);

  regs.rrca();
  m.step(0x114d, 4);

  regs.c = regs.a; // C = row/2
  m.step(0x114e, 4);

  regs.rrca();
  m.step(0x114f, 4);

  regs.add(regs.c); // A = row/4 + row/2 = 3/4*row
  m.step(0x1150, 4);

  regs.neg();
  m.step(0x1152, 8);

  regs.add(0x7c);
  m.step(0x1154, 7);

  mem.write8(regs.ix + 0x03, regs.a); // sprite Y
  m.step(0x1157, 19);

  regs.a = mem.read8(regs.ix + 0x07);
  m.step(0x115a, 19);

  regs.and(0x0f); // column bits (0-3)
  m.step(0x115c, 7);

  regs.rlca();
  m.step(0x115d, 4);
  regs.rlca();
  m.step(0x115e, 4);
  regs.rlca();
  m.step(0x115f, 4);
  regs.rlca();
  m.step(0x1160, 4); // column << 4

  regs.add(0x07);
  m.step(0x1162, 7);

  regs.c = regs.a;
  m.step(0x1163, 4);

  regs.a = mem.read8(0x420e); // X base (scroll/anchor)
  m.step(0x1166, 13);

  regs.add(regs.c);
  m.step(0x1167, 4);

  mem.write8(regs.ix + 0x04, regs.a); // sprite X
  m.step(0x116a, 19);

  m.ret();
}

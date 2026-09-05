// SPDX-License-Identifier: GPL-3.0-only

// loc_01e1  (ROM 0x01e1-0x0217) — sub-state handler (rst-0x28 target @0x016a). rst-0x10 fills 0x1c bytes
// at the pointer (0x400b) with 0x10 and advances it by 0x20. Counts down (0x4009); `ret nz` holds until it
// expires. On expiry: bump (0x400a), reset the 0x4008 pointer word = 0x0440, rst-0x10 clear 0x30 bytes at
// 0x4200, clear flip_x/flip_y (0x7006/0x7007) + (0x4018), set (0x4238)=1, then tail-jump to 0x0598 (HL=0x1db1).
export function loc_01e1(m) {
  const { regs, mem } = m;

  regs.hl = mem.read16(0x400b);
  m.step(0x01e4, 16); // HL = fill pointer (0x400b)

  regs.b = 0x1c;
  m.step(0x01e6, 7); // fill count

  regs.a = 0x10;
  m.step(0x01e8, 7); // fill byte

  m.push16(0x01e9);
  m.step(0x0010, 11); // rst 0x10 -- fill 0x1c bytes <- 0x10 (HL advances by B)
  m.call(0x0010);

  regs.de = 0x0004;
  m.step(0x01ec, 10);

  regs.addHl(regs.de);
  m.step(0x01ed, 11); // pointer now advanced by 0x1c+4 = 0x20

  mem.write16(0x400b, regs.hl);
  m.step(0x01f0, 16);

  regs.hl = 0x4009;
  m.step(0x01f3, 10);

  regs.decMem8(mem, regs.hl);
  m.step(0x01f4, 11); // dec (0x4009) -- countdown

  if (regs.fNZ) {
    m.ret(11); // ret nz -- still counting
    return;
  }
  m.step(0x01f5, 5);

  regs.l = regs.inc8(regs.l);
  m.step(0x01f6, 4); // HL=0x400a

  regs.incMem8(mem, regs.hl);
  m.step(0x01f7, 11); // inc (0x400a)

  regs.hl = 0x0440;
  m.step(0x01fa, 10);

  mem.write16(0x4008, regs.hl);
  m.step(0x01fd, 16); // (0x4008) pointer word <- 0x0440

  regs.xor(regs.a);
  m.step(0x01fe, 4); // A=0

  regs.b = 0x30;
  m.step(0x0200, 7);

  regs.hl = 0x4200;
  m.step(0x0203, 10);

  m.push16(0x0204);
  m.step(0x0010, 11); // rst 0x10 -- clear 0x30 bytes at 0x4200 <- 0
  m.call(0x0010);

  mem.write8(0x7006, regs.a, 10);
  m.step(0x0207, 13); // flip_screen_x_w D0 <- 0

  mem.write8(0x7007, regs.a, 10);
  m.step(0x020a, 13); // flip_screen_y_w D0 <- 0

  mem.write8(0x4018, regs.a);
  m.step(0x020d, 13);

  regs.a = 0x01;
  m.step(0x020f, 7);

  mem.write8(0x4238, regs.a);
  m.step(0x0212, 13);

  regs.hl = 0x1db1;
  m.step(0x0215, 10); // HL = arg to 0x0598

  m.step(0x0598, 10);
  return m.call(0x0598);
}

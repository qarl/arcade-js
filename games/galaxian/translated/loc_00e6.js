// SPDX-License-Identifier: GPL-3.0-only

// loc_00e6  (ROM 0x00e6-0x0151) — game-state routine, rst-28 dispatch target from loc_0066's table @0x00ce.
// Block-fills 0x20 bytes of the buffer pointed to by (0x400b) with 0x10 and stores the advanced pointer,
// then decrements the frame counter at 0x4008 and bails (ret nz) until it reaches 0. On the zero tick it
// resets state cells (0x4005-0x4007, 0x400a), folds three config/dip bytes into 0x4000/0x401f/0x400f,
// looks IN2&3 up through the 4-byte table @0x0152 into 0x40ac, seeds three VRAM cells, and tail-jumps to
// loc_08f2 (which rets to 0x00d8, the NMI epilogue loc_0066 pushed before dispatch).
export function loc_00e6(m) {
  const { regs, mem } = m;

  regs.hl = mem.read16(0x400b);
  m.step(0x00e9, 16); // ld hl,(0x400b) -- fill-buffer pointer

  regs.b = 0x20;
  m.step(0x00eb, 7);

  regs.a = 0x10;
  m.step(0x00ed, 7);

  m.push16(0x00ee);
  m.step(0x0010, 11); // rst 0x10 -- fill (HL..HL+0x1f) <- 0x10; HL += 0x20
  m.call(0x0010);

  mem.write16(0x400b, regs.hl);
  m.step(0x00f1, 16); // ld (0x400b),hl -- store the advanced pointer

  regs.hl = 0x4008;
  m.step(0x00f4, 10);

  regs.decMem8(mem, regs.hl);
  m.step(0x00f5, 11); // dec (0x4008) -- per-state frame countdown

  if (regs.fNZ) {
    m.ret(11); // ret nz -- not elapsed yet, stay in this state
    return;
  }
  m.step(0x00f6, 5);

  regs.l = regs.dec8(regs.l);
  m.step(0x00f7, 4); // HL=0x4007

  mem.write8(regs.hl, 0x01);
  m.step(0x00f9, 10); // 0x4007 <- 1

  regs.l = regs.dec8(regs.l);
  m.step(0x00fa, 4); // HL=0x4006

  mem.write8(regs.hl, 0x00);
  m.step(0x00fc, 10); // 0x4006 <- 0

  regs.l = regs.dec8(regs.l);
  m.step(0x00fd, 4); // HL=0x4005

  mem.write8(regs.hl, 0x01);
  m.step(0x00ff, 10); // 0x4005 <- 1

  regs.xor(regs.a);
  m.step(0x0100, 4);

  mem.write8(0x400a, regs.a);
  m.step(0x0103, 13); // 0x400a <- 0

  regs.a = mem.read8(0x4011);
  m.step(0x0106, 13);

  regs.rlca();
  m.step(0x0107, 4);

  regs.rlca();
  m.step(0x0108, 4);

  regs.and(0x03);
  m.step(0x010a, 7); // bits 6-7 of 0x4011 -> 0..3

  mem.write8(0x4000, regs.a);
  m.step(0x010d, 13);

  regs.a = mem.read8(0x4012);
  m.step(0x0110, 13);

  regs.and(0x04);
  m.step(0x0112, 7);

  regs.rrca();
  m.step(0x0113, 4);

  regs.rrca();
  m.step(0x0114, 4);

  mem.write8(0x401f, regs.a);
  m.step(0x0117, 13); // bit2 of 0x4012 -> bit0

  regs.de = 0x051b;
  m.step(0x011a, 10);

  m.push16(0x011d);
  m.step(0x0646, 17); // call 0x0646
  m.call(0x0646);

  regs.a = mem.read8(0x4010);
  m.step(0x0120, 13);

  regs.and(0x20);
  m.step(0x0122, 7);

  regs.rlca();
  m.step(0x0123, 4);

  regs.rlca();
  m.step(0x0124, 4);

  regs.rlca();
  m.step(0x0125, 4); // bit5 of 0x4010 -> bit0

  mem.write8(0x400f, regs.a);
  m.step(0x0128, 13);

  regs.a = mem.read8(0x7000);
  m.step(0x012b, 13); // ld a,(0x7000) -- IN2 port

  regs.and(0x03);
  m.step(0x012d, 7);

  regs.hl = 0x0152;
  m.step(0x0130, 10); // table base @0x0152 (DATA: 07 10 12 20)

  m.push16(0x0131);
  m.step(0x0020, 11); // rst 0x20 -- A = (0x0152 + A)
  m.call(0x0020);

  mem.write8(0x40ac, regs.a);
  m.step(0x0134, 13); // 0x40ac <- table lookup

  m.push16(0x0137);
  m.step(0x0595, 17); // call 0x0595
  m.call(0x0595);

  regs.a = 0x01;
  m.step(0x0139, 7);

  mem.write8(0x5340, regs.a);
  m.step(0x013c, 13); // VRAM 0x5340 <- 1

  regs.a = 0x25;
  m.step(0x013e, 7);

  mem.write8(0x5320, regs.a);
  m.step(0x0141, 13); // VRAM 0x5320 <- 0x25

  regs.a = 0x20;
  m.step(0x0143, 7);

  mem.write8(0x5300, regs.a);
  m.step(0x0146, 13); // VRAM 0x5300 <- 0x20

  regs.de = 0x0604;
  m.step(0x0149, 10);

  m.push16(0x014c);
  m.step(0x08f2, 17); // call 0x08f2
  m.call(0x08f2);

  regs.de = 0x0503;
  m.step(0x014f, 10);

  // jp 0x08f2 -- tail-jump (loc_08f2 rets to 0x00d8, the pushed NMI epilogue)
  m.step(0x08f2, 10);
  return m.call(0x08f2);
}

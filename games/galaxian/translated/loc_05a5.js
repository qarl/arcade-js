// SPDX-License-Identifier: GPL-3.0-only

// loc_05a5  (ROM 0x05a5-0x05e1) — board/level setup: copy 8 bytes from the pointer loc_0646 returns into
// 0x4218; zero 0x425f/0x4220/0x4018 and the flip latches (0x7006 flip_x, 0x7007 flip_y); bump 0x400a and set
// 0x4009=0x96; set 0x4245=0x0640. Then test flag 0x4006 bit0 (ret if clear) and 0x400e bit0: set -> loc_05fc,
// clear -> enqueue sound cmd 0x0500 via loc_08f2 and fall through to loc_05e2. Dispatch-table target.
export function loc_05a5(m) {
  const { regs, mem } = m;

  regs.de = 0x4180;
  m.step(0x05a8, 10);

  m.push16(0x05ab);
  m.step(0x0646, 17);
  m.call(0x0646); // DE -> source pointer

  regs.exDeHl();
  m.step(0x05ac, 4); // HL = source pointer

  regs.de = 0x4218;
  m.step(0x05af, 10); // dest

  regs.bc = 0x0008;
  m.step(0x05b2, 10);

  m.ldirAt(0x05b2, 0x05b4); // copy 8 bytes -> 0x4218

  regs.xor(regs.a);
  m.step(0x05b5, 4); // A = 0

  mem.write8(0x425f, regs.a);
  m.step(0x05b8, 13);

  mem.write8(0x4220, regs.a);
  m.step(0x05bb, 13);

  mem.write8(0x7006, regs.a, 10);
  m.step(0x05be, 13); // flip_x latch = 0

  mem.write8(0x7007, regs.a, 10);
  m.step(0x05c1, 13); // flip_y latch = 0

  mem.write8(0x4018, regs.a);
  m.step(0x05c4, 13);

  regs.hl = 0x400a;
  m.step(0x05c7, 10);

  regs.incMem8(mem, regs.hl);
  m.step(0x05c8, 11); // inc (0x400a)

  regs.l = regs.dec8(regs.l);
  m.step(0x05c9, 4); // HL -> 0x4009

  mem.write8(regs.hl, 0x96);
  m.step(0x05cb, 10); // (0x4009) = 0x96

  regs.hl = 0x0640;
  m.step(0x05ce, 10);

  mem.write16(0x4245, regs.hl);
  m.step(0x05d1, 16); // (0x4245) = 0x0640

  regs.a = mem.read8(0x4006);
  m.step(0x05d4, 13);

  regs.rrca();
  m.step(0x05d5, 4); // bit0 -> carry

  if (regs.fNC) {
    m.ret(11); // ret nc -- flag 0x4006 bit0 clear: done
    return;
  }
  m.step(0x05d6, 5);

  regs.a = mem.read8(0x400e);
  m.step(0x05d9, 13);

  regs.rrca();
  m.step(0x05da, 4); // bit0 -> carry

  if (regs.fC) {
    m.step(0x05fc, 12); // jr c,0x05fc (taken)
    return m.call(0x05fc);
  }
  m.step(0x05dc, 7);

  regs.de = 0x0500;
  m.step(0x05df, 10);

  m.push16(0x05e2);
  m.step(0x08f2, 17);
  m.call(0x08f2); // enqueue sound cmd DE

  return m.call(0x05e2); // fall through to loc_05e2
}

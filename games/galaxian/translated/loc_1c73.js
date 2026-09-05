// SPDX-License-Identifier: GPL-3.0-only

// loc_1c73  (ROM 0x1C73-0x1CB4) — decodes three 2-bit input fields (IN1/IN2) via loc_1ccf; unless IN0
// bit 6 is set (early ret nz), inits work-RAM state and memsets the 0x6000 block via rst 0x10. Falls into loc_1cb5.
export function loc_1c73(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x6800);
  m.step(0x1c76, 13); // ld a,(0x6800) -- IN1

  regs.rlca();
  m.step(0x1c77, 4);

  regs.rlca();
  m.step(0x1c78, 4);

  regs.and(0x03);
  m.step(0x1c7a, 7); // and 0x03 -- IN1 bits 6-7 -> 0..3

  m.push16(0x1c7d);
  m.step(0x1ccf, 17);
  m.call(0x1ccf);

  regs.a = mem.read8(0x7000);
  m.step(0x1c80, 13); // ld a,(0x7000) -- IN2

  regs.and(0x03);
  m.step(0x1c82, 7);

  regs.add(0x04);
  m.step(0x1c84, 7); // add a,0x04 -- field index 4..7

  m.push16(0x1c87);
  m.step(0x1ccf, 17);
  m.call(0x1ccf);

  regs.a = mem.read8(0x7000);
  m.step(0x1c8a, 13); // ld a,(0x7000) -- IN2

  regs.rrca();
  m.step(0x1c8b, 4);

  regs.rrca();
  m.step(0x1c8c, 4);

  regs.and(0x01);
  m.step(0x1c8e, 7); // and 0x01 -- IN2 bit 2 -> 0..1

  regs.add(0x08);
  m.step(0x1c90, 7); // add a,0x08 -- field index 8..9

  m.push16(0x1c93);
  m.step(0x1ccf, 17);
  m.call(0x1ccf);

  regs.a = mem.read8(0x6000);
  m.step(0x1c96, 13); // ld a,(0x6000) -- IN0

  regs.and(0x40);
  m.step(0x1c98, 7); // and 0x40 -- IN0 bit 6

  if (regs.fNZ) {
    m.ret(11); // ret nz (taken) -- bail before the state init
    return;
  }
  m.step(0x1c99, 5);

  regs.xor(regs.a);
  m.step(0x1c9a, 4); // xor a -- A=0

  mem.write8(0x4006, regs.a);
  m.step(0x1c9d, 13);

  regs.a = 0x02;
  m.step(0x1c9f, 7);

  mem.write8(0x401a, regs.a);
  m.step(0x1ca2, 13);

  regs.hl = 0x3010;
  m.step(0x1ca5, 10);

  mem.write16(0x4008, regs.hl);
  m.step(0x1ca8, 16);

  regs.hl = 0x5000;
  m.step(0x1cab, 10);

  mem.write16(0x400b, regs.hl);
  m.step(0x1cae, 16);

  regs.xor(regs.a);
  m.step(0x1caf, 4); // xor a -- A=0 (fill value)

  regs.hl = 0x6000;
  m.step(0x1cb2, 10); // ld hl,0x6000 (fill dest -- 0x6000 latch/sound block)

  regs.b = 0x04;
  m.step(0x1cb4, 7);

  m.push16(0x1cb5);
  m.step(0x0010, 11); // rst 0x10 -- loc_0010 memset (writes A to B bytes at HL, then ret)
  m.call(0x0010);

  // fall-through into loc_1cb5 -- delegate, do not inline
  return m.call(0x1cb5);
}

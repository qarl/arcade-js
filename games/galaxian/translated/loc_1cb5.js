// SPDX-License-Identifier: GPL-3.0-only

// loc_1cb5  (ROM 0x1cb5-0x1cce) — silence the sound hardware: block-fill the lfo_freq latches
// (0x6004-0x6007)=1, the sound_w regs (0x6800-0x6807)=0, and the 0x7001-block latches (0x7001-0x7005)=0
// via rst 0x10 (loc_0010 block-fill), then pitch_w (0x7800)=0xFF. Reached by fall-through from loc_1c73.
export function loc_1cb5(m) {
  const { regs, mem } = m;

  regs.a = 0x01;
  m.step(0x1cb7, 7); // ld a,0x01

  regs.hl = 0x6004;
  m.step(0x1cba, 10); // ld hl,0x6004 -- lfo_freq latch base

  regs.b = 0x04;
  m.step(0x1cbc, 7); // ld b,0x04

  m.push16(0x1cbd);
  m.step(0x0010, 11); // rst 0x10 -- block-fill (0x6004-0x6007) <- A=1
  m.call(0x0010);

  regs.xor(regs.a);
  m.step(0x1cbe, 4); // xor a -- A=0

  regs.b = 0x08;
  m.step(0x1cc0, 7); // ld b,0x08

  regs.hl = 0x6800;
  m.step(0x1cc3, 10); // ld hl,0x6800 -- sound_w base

  m.push16(0x1cc4);
  m.step(0x0010, 11); // rst 0x10 -- block-fill (0x6800-0x6807) <- A=0
  m.call(0x0010);

  regs.b = 0x05;
  m.step(0x1cc6, 7); // ld b,0x05

  regs.hl = 0x7001;
  m.step(0x1cc9, 10); // ld hl,0x7001 -- irq_enable/stars/flip latch block

  m.push16(0x1cca);
  m.step(0x0010, 11); // rst 0x10 -- block-fill (0x7001-0x7005) <- A=0 (0x7002/3/5 unmapped, drop)
  m.call(0x0010);

  regs.a = regs.dec8(regs.a);
  m.step(0x1ccb, 4); // dec a -- A=0-1=0xFF

  mem.write8(0x7800, regs.a, 10);
  m.step(0x1cce, 13); // ld (0x7800),a -- pitch_w <- 0xFF

  m.ret();
}

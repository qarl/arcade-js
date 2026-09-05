// SPDX-License-Identifier: GPL-3.0-only

// loc_16f5  (ROM 0x16f5-0x1722) — the sound driver's per-frame tick. Clears composite cell 0x41c0 and sets
// 0x41c1=0xFF, runs the seven channel/effect updaters, then latches the composed bytes to the hardware:
// 0x41c0 -> sound_w reg6, its rrca -> reg7, 0x41c1 -> pitch_w (0x7800).
export function loc_16f5(m) {
  const { regs, mem } = m;

  regs.xor(regs.a);
  m.step(0x16f6, 4);

  mem.write8(0x41c0, regs.a); // 0x41c0: composite reg6 source (cleared)
  m.step(0x16f9, 13);

  regs.a = regs.dec8(regs.a); // A = 0xFF
  m.step(0x16fa, 4);

  mem.write8(0x41c1, regs.a); // 0x41c1: pitch source (init 0xFF)
  m.step(0x16fd, 13);

  m.push16(0x1700);
  m.step(0x1747, 17);
  m.call(0x1747);

  m.push16(0x1703);
  m.step(0x17d0, 17);
  m.call(0x17d0);

  m.push16(0x1706);
  m.step(0x1819, 17);
  m.call(0x1819);

  m.push16(0x1709);
  m.step(0x175d, 17);
  m.call(0x175d);

  m.push16(0x170c);
  m.step(0x184f, 17);
  m.call(0x184f);

  m.push16(0x170f);
  m.step(0x1876, 17);
  m.call(0x1876);

  m.push16(0x1712);
  m.step(0x1723, 17);
  m.call(0x1723);

  regs.a = mem.read8(0x41c0);
  m.step(0x1715, 13);

  mem.write8(0x6806, regs.a, 10); // sound_w reg6; busOffset 10
  m.step(0x1718, 13);

  regs.rrca();
  m.step(0x1719, 4);

  mem.write8(0x6807, regs.a, 10); // sound_w reg7 = rrca(reg6)
  m.step(0x171c, 13);

  regs.a = mem.read8(0x41c1);
  m.step(0x171f, 13);

  mem.write8(0x7800, regs.a, 10); // pitch_w; busOffset 10
  m.step(0x1722, 13);

  return m.ret();
}

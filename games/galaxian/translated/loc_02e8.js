// SPDX-License-Identifier: GPL-3.0-only

// loc_02e8  (ROM 0x02e8-0x02fc) — rst-28 state handler: block-fill work RAM 0x4100-0x417F=0 (rst 0x10),
// clear 0x425F/0x4238, set the 0x4009 timer=0x40, then tail-jump into loc_0593.
export function loc_02e8(m) {
  const { regs, mem } = m;

  regs.hl = 0x4100;
  m.step(0x02eb, 10);

  regs.b = 0x80;
  m.step(0x02ed, 7);

  regs.xor(regs.a); // A=0 (fill value)
  m.step(0x02ee, 4);

  m.push16(0x02ef);
  m.step(0x0010, 11); // rst 0x10 -- block-fill (0x4100-0x417F) <- A=0
  m.call(0x0010);

  mem.write8(0x425f, regs.a);
  m.step(0x02f2, 13); // 0x425F <- 0

  mem.write8(0x4238, regs.a);
  m.step(0x02f5, 13); // 0x4238 <- 0

  regs.hl = 0x4009;
  m.step(0x02f8, 10);

  mem.write8(regs.hl, 0x40);
  m.step(0x02fa, 10); // ld (0x4009),0x40 -- timer

  // jp 0x0593 -- tail-jump to the next state routine (its flow is ours)
  m.step(0x0593, 10);
  return m.call(0x0593);
}

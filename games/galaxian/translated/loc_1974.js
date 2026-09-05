// SPDX-License-Identifier: GPL-3.0-only

// loc_1974  (ROM 0x1974-0x197b) — rotate A right 3x (A>>>3) and store to the 0x6003 latch (0x6000-block
// reg3 = coin_count_0 D0 on the galaxian board), then dec (hl). Entry A + HL supplied by the caller.
export function loc_1974(m) {
  const { regs, mem } = m;

  regs.rrca();
  m.step(0x1975, 4);

  regs.rrca();
  m.step(0x1976, 4);

  regs.rrca();
  m.step(0x1977, 4);

  mem.write8(0x6003, regs.a, 10); // 0x6003 latch (coin_count_0 D0); busOffset 10 (ld (nn),a)
  m.step(0x197a, 13);

  regs.decMem8(mem, regs.hl); // dec (hl) -- caller's counter cell--
  m.step(0x197b, 11);

  return m.ret();
}

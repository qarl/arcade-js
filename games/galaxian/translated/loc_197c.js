// SPDX-License-Identifier: GPL-3.0-only

// loc_197c  (ROM 0x197c-0x1988) — read the 0x4002 counter; if it is >= 9, tail to loc_1989 (clears the
// 0x6002 latch), else set the 0x6002 latch (coin_lock D0 on the galaxian board) to 1 and ret.
export function loc_197c(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4002); // 0x4002: work-RAM counter
  m.step(0x197f, 13);

  regs.cp(0x09); // carry set when A < 9
  m.step(0x1981, 7);

  if (regs.fNC) {
    // jr nc,0x1989 (taken) -- A >= 9: tail to loc_1989
    m.step(0x1989, 12);
    return m.call(0x1989);
  }
  m.step(0x1983, 7); // jr nc (not taken)

  regs.a = 0x01;
  m.step(0x1985, 7);

  mem.write8(0x6002, regs.a, 10); // 0x6002 latch (coin_lock D0) = 1; busOffset 10
  m.step(0x1988, 13);

  return m.ret();
}

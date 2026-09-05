// SPDX-License-Identifier: GPL-3.0-only

// loc_1931  (ROM 0x1931-0x194e) — timer 0x4003/0x4004 tick. 0x4003 nonzero -> loc_1974. Else if 0x4004==0
// ret; otherwise 0x4004--, reload 0x4003=0x0f, then branch on mode 0x4000: ==3 ret, ==1 -> loc_1964,
// ==2 -> HL=0x4002 and a conditional+fall-through double run of loc_194f (else fall through once).
export function loc_1931(m) {
  const { regs, mem } = m;

  regs.hl = 0x4003;
  m.step(0x1934, 10);

  regs.a = mem.read8(regs.hl); // 0x4003: reload timer
  m.step(0x1935, 7);

  regs.and(regs.a);
  m.step(0x1936, 4);

  if (regs.fNZ) {
    m.step(0x1974, 12); // jr nz,0x1974 (timer not expired)
    return m.call(0x1974);
  }
  m.step(0x1938, 7); // jr nz (not taken)

  regs.l = regs.inc8(regs.l); // -> 0x4004
  m.step(0x1939, 4);

  regs.or(mem.read8(regs.hl)); // A = 0x4004
  m.step(0x193a, 7);

  if (regs.fZ) { m.ret(11); return; } // ret z -- 0x4004 == 0
  m.step(0x193b, 5);

  regs.decMem8(mem, regs.hl); // 0x4004--
  m.step(0x193c, 11);

  regs.l = regs.dec8(regs.l); // -> 0x4003
  m.step(0x193d, 4);

  mem.write8(regs.hl, 0x0f); // 0x4003 = 0x0f (reload)
  m.step(0x193f, 10);

  regs.a = mem.read8(0x4000); // 0x4000: game mode
  m.step(0x1942, 13);

  regs.cp(0x03);
  m.step(0x1944, 7);

  if (regs.fZ) { m.ret(11); return; } // ret z -- mode 3
  m.step(0x1945, 5);

  regs.a = regs.dec8(regs.a);
  m.step(0x1946, 4);

  if (regs.fZ) {
    m.step(0x1964, 12); // jr z,0x1964 (mode 1)
    return m.call(0x1964);
  }
  m.step(0x1948, 7); // jr z (not taken)

  regs.hl = 0x4002;
  m.step(0x194b, 10);

  regs.a = regs.dec8(regs.a); // Z when mode was 2
  m.step(0x194c, 4);

  if (regs.fZ) {
    m.push16(0x194f); // call z,0x194f (taken); return addr IS loc_194f (fall-through)
    m.step(0x194f, 17);
    m.call(0x194f);
  } else {
    m.step(0x194f, 10); // call z (not taken)
  }

  // fall-through into loc_194f
  return m.call(0x194f);
}

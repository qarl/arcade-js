// SPDX-License-Identifier: GPL-3.0-only

// loc_1734  (ROM 0x1734-0x1747)
export function loc_1734(m) {
  const { regs, mem } = m;

  m.push16(0x1737);
  m.step(0x0201, 17); // 1734  call 0x0201
  m.call(0x0201);

  if (regs.fNZ) {
    m.ret(11); // 1737  ret nz (taken)
    return;
  }
  m.step(0x1738, 5); // 1737  ret nz (not taken)

  regs.hl = 0x1748;
  m.step(0x173b, 10); // 1738  ld hl,0x1748 -- loc_1748's first byte
  regs.b = 0x22;
  m.step(0x173d, 7); // 173b  ld b,0x22 -- the 33-byte routine plus the unreferenced byte at 0x1769
  regs.xor(regs.a);
  m.step(0x173e, 4); // 173d  xor a

  do {
    regs.sub(mem.read8(regs.hl));
    m.step(0x173f, 7); // 173e  sub (hl)
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1740, 6); // 173f  inc hl
    regs.djnz(); // no flags
    m.step(regs.b !== 0 ? 0x173e : 0x1742, regs.b !== 0 ? 13 : 8); // 1740  djnz 0x173e
  } while (regs.b !== 0);

  mem.write8(0xa817, regs.a);
  m.step(0x1745, 13); // 1742  ld (0xa817),a -- 0x00 on a clean ROM

  m.step(0x0f1a, 10); // 1745  jp 0x0f1a -- TAIL jump, nothing pushed
  return m.call(0x0f1a);
}

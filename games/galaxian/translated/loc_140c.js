// SPDX-License-Identifier: GPL-3.0-only

// loc_140c  (ROM 0x140c-0x1445) — gated by (0x4220) bit0 clear, (0x4200) bit0, and (0x4229) bit0 (consumed);
// bails unless (0x42d0) pair is zero. Reads direction (0x4215) into C; bit0 -> tail-jump to the right-hand
// scan 0x14be, else scans the left column groups at 0x4179 (down, B=4) then 0x416a (down, B=4) with bit0
// tests: a hit in the first group tail-jumps to 0x1472, a hit in the second to the placement routine 0x1446.
// Interior labels 1433/143e inlined.
export function loc_140c(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4220);
  m.step(0x140f, 13);
  regs.rrca();
  m.step(0x1410, 4);
  if (regs.fC) { m.ret(11); return; } // ret c
  m.step(0x1411, 5);
  regs.a = mem.read8(0x4200);
  m.step(0x1414, 13);
  regs.rrca();
  m.step(0x1415, 4);
  if (regs.fNC) { m.ret(11); return; } // ret nc
  m.step(0x1416, 5);
  regs.a = mem.read8(0x4229);
  m.step(0x1419, 13);
  regs.rrca();
  m.step(0x141a, 4);
  if (regs.fNC) { m.ret(11); return; } // ret nc
  m.step(0x141b, 5);
  regs.xor(regs.a);
  m.step(0x141c, 4);
  mem.write8(0x4229, regs.a);
  m.step(0x141f, 13); // consume the trigger
  regs.hl = mem.read16(0x42d0);
  m.step(0x1422, 16);
  regs.a = regs.h;
  m.step(0x1423, 4);
  regs.or(regs.l);
  m.step(0x1424, 4);
  regs.rrca();
  m.step(0x1425, 4);
  if (regs.fC) { m.ret(11); return; } // ret c -- (0x42d0) nonzero
  m.step(0x1426, 5);
  regs.a = mem.read8(0x4215);
  m.step(0x1429, 13);
  regs.c = regs.a;
  m.step(0x142a, 4); // C = direction
  regs.rrca();
  m.step(0x142b, 4);
  if (regs.fC) {
    m.step(0x14be, 10); // jp c,0x14be (tail)
    return m.call(0x14be);
  }
  m.step(0x142e, 10);
  regs.hl = 0x4179;
  m.step(0x1431, 10);
  regs.b = 0x04;
  m.step(0x1433, 7);

  // loc_1433: first column group (descending)
  for (;;) {
    regs.bit(0, mem.read8(regs.hl));
    m.step(0x1435, 12);
    if (regs.fNZ) {
      m.step(0x1472, 12); // jr nz,0x1472 (tail)
      return m.call(0x1472);
    }
    m.step(0x1437, 7);
    regs.l = regs.dec8(regs.l);
    m.step(0x1438, 4);
    if (regs.djnz() !== 0) { m.step(0x1433, 13); continue; }
    m.step(0x143a, 8);
    break;
  }

  regs.l = 0x6a;
  m.step(0x143c, 7);
  regs.b = 0x04;
  m.step(0x143e, 7);

  // loc_143e: second column group (descending)
  for (;;) {
    regs.bit(0, mem.read8(regs.hl));
    m.step(0x1440, 12);
    if (regs.fNZ) {
      m.step(0x1446, 12); // jr nz,0x1446 (tail -- placement)
      return m.call(0x1446);
    }
    m.step(0x1442, 7);
    regs.l = regs.dec8(regs.l);
    m.step(0x1443, 4);
    if (regs.djnz() !== 0) { m.step(0x143e, 13); continue; }
    m.step(0x1445, 8);
    break;
  }

  m.ret(); // 0x1445 -- nothing to place
}

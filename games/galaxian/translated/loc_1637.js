// SPDX-License-Identifier: GPL-3.0-only

// loc_1637  (ROM 0x1637-0x1685) — per-tick handler gated by 0x4222 D0 with a countdown at 0x4223. On the
// zero tick it clears state (0x4222/0x421a/0x425f), seeds 0x420e=1, advances the 0x421b selector (clamped to
// 7 via the loc_1662/loc_1683 arms), runs loc_08f2, then services the 0x421e request into 0x4177/0x4178.
export function loc_1637(m) {
  const { regs, mem } = m;

  regs.hl = 0x4222;
  m.step(0x163a, 10);

  regs.bit(0, mem.read8(regs.hl));
  m.step(0x163c, 12); // bit 0,(0x4222) -- enable flag

  if (regs.fZ) { m.ret(11); return; } // ret z
  m.step(0x163d, 5);

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x163e, 6); // inc hl -> 0x4223

  regs.decMem8(mem, regs.hl);
  m.step(0x163f, 11); // dec (0x4223) -- countdown

  if (regs.fNZ) { m.ret(11); return; } // ret nz
  m.step(0x1640, 5);

  regs.hl = (regs.hl - 1) & 0xffff;
  m.step(0x1641, 6); // dec hl -> 0x4222

  mem.write8(regs.hl, 0x00);
  m.step(0x1643, 10); // 0x4222 <- 0

  regs.de = 0x051b;
  m.step(0x1646, 10);

  m.push16(0x1649);
  m.step(0x0646, 17); // call 0x0646
  m.call(0x0646);

  regs.xor(regs.a);
  m.step(0x164a, 4);

  mem.write8(0x421a, regs.a);
  m.step(0x164d, 13); // 0x421a <- 0

  mem.write8(0x425f, regs.a);
  m.step(0x1650, 13); // 0x425f <- 0

  regs.hl = 0x0001;
  m.step(0x1653, 10);

  mem.write16(0x420e, regs.hl);
  m.step(0x1656, 16); // 0x420e <- 1

  regs.hl = mem.read16(0x421b);
  m.step(0x1659, 16); // ld hl,(0x421b) -- selector

  regs.h = regs.inc8(regs.h);
  m.step(0x165a, 4);

  regs.a = regs.l;
  m.step(0x165b, 4);

  regs.cp(0x07);
  m.step(0x165d, 7);

  if (regs.fZ) {
    m.step(0x1662, 12); // jr z,0x1662 -- already 7
  } else {
    m.step(0x165f, 7);
    if (regs.fNC) {
      m.step(0x1683, 12); // jr nc,0x1683 -- >7, clamp
      regs.a = 0x07;
      m.step(0x1685, 7); // loc_1683: ld a,0x07
      m.step(0x1662, 10); // jp 0x1662
    } else {
      m.step(0x1661, 7);
      regs.a = regs.inc8(regs.a);
      m.step(0x1662, 4); // inc a -> loc_1662
    }
  }

  // loc_1662:
  regs.l = regs.a;
  m.step(0x1663, 4);

  mem.write16(0x421b, regs.hl);
  m.step(0x1666, 16); // 0x421b <- selector

  regs.de = 0x0700;
  m.step(0x1669, 10);

  m.push16(0x166c);
  m.step(0x08f2, 17); // call 0x08f2
  m.call(0x08f2);

  regs.a = mem.read8(0x421e);
  m.step(0x166f, 13);

  regs.and(regs.a);
  m.step(0x1670, 4);

  if (regs.fZ) { m.ret(11); return; } // ret z -- no request pending
  m.step(0x1671, 5);

  regs.hl = 0x4177;
  m.step(0x1674, 10);

  mem.write8(regs.hl, 0x01);
  m.step(0x1676, 10); // 0x4177 <- 1

  regs.a = regs.dec8(regs.a);
  m.step(0x1677, 4);

  mem.write8(0x421e, regs.a);
  m.step(0x167a, 13); // 0x421e <- count-1

  if (regs.fZ) { m.ret(11); return; } // ret z
  m.step(0x167b, 5);

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x167c, 6); // inc hl -> 0x4178

  mem.write8(regs.hl, 0x01);
  m.step(0x167e, 10); // 0x4178 <- 1

  regs.xor(regs.a);
  m.step(0x167f, 4);

  mem.write8(0x421e, regs.a);
  m.step(0x1682, 13); // 0x421e <- 0

  m.ret();
}

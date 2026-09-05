// SPDX-License-Identifier: GPL-3.0-only

// loc_1688  (ROM 0x1688-0x16a5) — countdown at 0x422c gated by 0x422b D0. Fires early if any of 0x4224 /
// 0x4221 / 0x4226-D0 is set (jr to loc_169f), else waits for the counter to hit 0; on expiry clears 0x422b.
export function loc_1688(m) {
  const { regs, mem } = m;

  regs.hl = 0x422b;
  m.step(0x168b, 10);

  regs.bit(0, mem.read8(regs.hl));
  m.step(0x168d, 12); // bit 0,(0x422b) -- enable flag

  if (regs.fZ) { m.ret(11); return; } // ret z
  m.step(0x168e, 5);

  regs.a = mem.read8(0x4224);
  m.step(0x1691, 13);

  regs.and(regs.a);
  m.step(0x1692, 4);

  if (regs.fNZ) {
    m.step(0x169f, 12); // jr nz,0x169f
  } else {
    m.step(0x1694, 7);
    regs.a = mem.read8(0x4221);
    m.step(0x1697, 13);
    regs.and(regs.a);
    m.step(0x1698, 4);
    if (regs.fNZ) {
      m.step(0x169f, 12); // jr nz,0x169f
    } else {
      m.step(0x169a, 7);
      regs.a = mem.read8(0x4226);
      m.step(0x169d, 13);
      regs.rrca();
      m.step(0x169e, 4); // C <- 0x4226 D0
      if (regs.fNC) { m.ret(11); return; } // ret nc -- keep waiting
      m.step(0x169f, 5);
    }
  }

  // loc_169f:
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x16a0, 6); // inc hl -> 0x422c

  regs.decMem8(mem, regs.hl);
  m.step(0x16a1, 11); // dec (0x422c)

  if (regs.fNZ) { m.ret(11); return; } // ret nz
  m.step(0x16a2, 5);

  regs.hl = (regs.hl - 1) & 0xffff;
  m.step(0x16a3, 6); // dec hl -> 0x422b

  mem.write8(regs.hl, 0x00);
  m.step(0x16a5, 10); // 0x422b <- 0

  m.ret();
}

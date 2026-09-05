// SPDX-License-Identifier: GPL-3.0-only

// loc_1292  (ROM 0x1292-0x129d) — neighbour bonus: A++ only if BOTH the entries two and four slots ahead
// (bit0 of (ix+0x20) and (ix+0x40)) are inactive; otherwise A returns unchanged. Called from loc_125e.
export function loc_1292(m) {
  const { regs, mem } = m;

  regs.bit(0, mem.read8((regs.ix + 0x20) & 0xffff), ((regs.ix + 0x20) >> 8) & 0xff);
  m.step(0x1296, 20); // bit 0,(ix+0x20)
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- +0x20 neighbour still active
  m.step(0x1297, 5);

  regs.bit(0, mem.read8((regs.ix + 0x40) & 0xffff), ((regs.ix + 0x40) >> 8) & 0xff);
  m.step(0x129b, 20); // bit 0,(ix+0x40)
  if (regs.fNZ) { m.ret(11); return; } // ret nz -- +0x40 neighbour still active
  m.step(0x129c, 5);

  regs.a = regs.inc8(regs.a);
  m.step(0x129d, 4); // both inactive -> A++
  m.ret();
}

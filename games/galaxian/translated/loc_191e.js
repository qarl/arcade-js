// SPDX-License-Identifier: GPL-3.0-only

// loc_191e  (ROM 0x191e-0x1930) — bit7 branch of loc_18ef: bump counter 0x4002 while below cap 0x63; on a
// bump set flag 0x41c9=1 and enqueue command word 0x0701 by tail-jumping into loc_08f2.
export function loc_191e(m) {
  const { regs, mem } = m;

  regs.hl = 0x4002;
  m.step(0x1921, 10);

  regs.a = mem.read8(regs.hl); // 0x4002: counter (cap 0x63)
  m.step(0x1922, 7);

  regs.cp(0x63);
  m.step(0x1924, 7);

  if (regs.fNC) { m.ret(11); return; } // ret nc -- at/above cap
  m.step(0x1925, 5);

  regs.incMem8(mem, regs.hl); // 0x4002++
  m.step(0x1926, 11);

  regs.a = 0x01;
  m.step(0x1928, 7);

  mem.write8(0x41c9, regs.a); // 0x41c9 = 1 (event flag)
  m.step(0x192b, 13);

  regs.de = 0x0701;
  m.step(0x192e, 10); // DE = queue arg for loc_08f2

  // jp 0x08f2 -- tail into the command-queue enqueue
  m.step(0x08f2, 10);
  return m.call(0x08f2);
}

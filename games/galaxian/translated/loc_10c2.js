// SPDX-License-Identifier: GPL-3.0-only

// loc_10c2  (ROM 0x10c2-0x10d7) — per-object step (IX = object struct in WRAM): bump (ix+0x04), count
// down timer (ix+0x10); while nonzero just return. On expiry, call loc_08f2 with DE=0x06:(ix+0x07)+0x4b
// and advance state (ix+0x02).
export function loc_10c2(m) {
  const { regs, mem } = m;

  regs.incMem8(mem, regs.ix + 0x04);
  m.step(0x10c5, 23); // inc (ix+0x04)

  regs.decMem8(mem, regs.ix + 0x10);
  m.step(0x10c8, 23); // dec timer (ix+0x10)

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- timer not expired
  m.step(0x10c9, 5);

  regs.a = mem.read8(regs.ix + 0x07);
  m.step(0x10cc, 19); // ld a,(ix+0x07)

  regs.add(0x4b);
  m.step(0x10ce, 7);

  regs.e = regs.a;
  m.step(0x10cf, 4); // E = (ix+0x07)+0x4b

  regs.d = 0x06;
  m.step(0x10d1, 7);

  m.push16(0x10d4);
  m.step(0x08f2, 17);
  m.call(0x08f2); // call 0x08f2 (DE arg)

  regs.incMem8(mem, regs.ix + 0x02);
  m.step(0x10d7, 23); // advance state (ix+0x02)

  m.ret();
}

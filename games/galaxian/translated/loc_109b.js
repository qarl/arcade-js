// SPDX-License-Identifier: GPL-3.0-only

// loc_109b  (ROM 0x109b-0x10c1) — per-object step (IX = object struct in WRAM). Derives n=(~(ix+0x07))&3;
// stores n+1 at (ix+0x16), (n+1)<<4 + 0x8c at (ix+0x03), sets timer (ix+0x10)=0x18, advances state
// (ix+0x02), clears (ix+0x0f) — then leaves (ix+0x0f)=0x18 ONLY when n==0.
export function loc_109b(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(regs.ix + 0x07);
  m.step(0x109e, 19); // ld a,(ix+0x07)

  regs.cpl();
  m.step(0x109f, 4);

  regs.and(0x03);
  m.step(0x10a1, 7);

  regs.b = regs.a;
  m.step(0x10a2, 4); // B = n = (~(ix+7))&3

  regs.a = regs.inc8(regs.a);
  m.step(0x10a3, 4);

  mem.write8(regs.ix + 0x16, regs.a);
  m.step(0x10a6, 19); // (ix+0x16) <- n+1

  regs.rlca();
  m.step(0x10a7, 4);
  regs.rlca();
  m.step(0x10a8, 4);
  regs.rlca();
  m.step(0x10a9, 4);
  regs.rlca();
  m.step(0x10aa, 4); // A = (n+1)<<4  (n+1<=4, no wrap)

  regs.add(0x8c);
  m.step(0x10ac, 7);

  mem.write8(regs.ix + 0x03, regs.a);
  m.step(0x10af, 19); // (ix+0x03) <- (n+1)<<4 + 0x8c

  mem.write8(regs.ix + 0x10, 0x18);
  m.step(0x10b3, 19); // timer (ix+0x10) <- 0x18

  regs.incMem8(mem, regs.ix + 0x02);
  m.step(0x10b6, 23); // advance state (ix+0x02)

  mem.write8(regs.ix + 0x0f, 0x00);
  m.step(0x10ba, 19); // (ix+0x0f) <- 0

  regs.a = regs.b;
  m.step(0x10bb, 4);

  regs.and(regs.a);
  m.step(0x10bc, 4); // test n

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- n!=0, leave (ix+0x0f)=0
  m.step(0x10bd, 5);

  mem.write8(regs.ix + 0x0f, 0x18);
  m.step(0x10c1, 19); // n==0: (ix+0x0f) <- 0x18

  m.ret();
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_20cd  (ROM 0x20cd-0x20e0) — paints a 3-cell VIDEORAM column from the caller's HL, stepping by DE:
// (HL)=A+1, (HL+DE)=0x25, (HL+2DE)=0x20. Then, only when B bit 4 is clear AND work-RAM 0x4006 is zero,
// clears the 0x40ab flag (A is 0 at that point). HL/DE/B/A come from the caller.
export function loc_20cd(m) {
  const { regs, mem } = m;

  regs.a = regs.inc8(regs.a);
  m.step(0x20ce, 4);

  mem.write8(regs.hl, regs.a); // (HL) = A (char code), VIDEORAM
  m.step(0x20cf, 7);

  regs.addHl(regs.de); // next cell (DE stride)
  m.step(0x20d0, 11);

  mem.write8(regs.hl, 0x25); // tile 0x25
  m.step(0x20d2, 10);

  regs.addHl(regs.de);
  m.step(0x20d3, 11);

  mem.write8(regs.hl, 0x20); // tile 0x20
  m.step(0x20d5, 10);

  regs.bit(4, regs.b); // Z = B bit 4 clear
  m.step(0x20d7, 8);

  if (regs.fNZ) {
    m.ret(11); // ret nz -- B bit 4 set: leave 0x40ab
    return;
  }
  m.step(0x20d8, 5);

  regs.a = mem.read8(0x4006);
  m.step(0x20db, 13);

  regs.and(regs.a); // test 0x4006 for zero
  m.step(0x20dc, 4);

  if (regs.fNZ) {
    m.ret(11); // ret nz -- 0x4006 nonzero
    return;
  }
  m.step(0x20dd, 5);

  mem.write8(0x40ab, regs.a); // clear the 0x40ab flag (A=0)
  m.step(0x20e0, 13);

  m.ret();
}

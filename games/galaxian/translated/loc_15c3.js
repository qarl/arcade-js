// SPDX-License-Identifier: GPL-3.0-only

// loc_15c3  (ROM 0x15c3-0x15de) — guarded one-shot, call target from the 0x0697 handler chain. Rets unless
// (0x422e) bit0 set. Counts down (0x422f); while non-zero rets. On the zero tick clears (0x422e)=0, then
// (gated on (0x4200) bit0 set and (0x41ef) bit0 set) writes (0x4229)=1.
export function loc_15c3(m) {
  const { regs, mem } = m;

  regs.hl = 0x422e;
  m.step(0x15c6, 10);

  regs.bit(0, mem.read8(regs.hl));
  m.step(0x15c8, 12); // bit 0,(0x422e)

  if (regs.fZ) { m.ret(11); return; } // ret z -- (0x422e) bit0 clear
  m.step(0x15c9, 5);

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x15ca, 6); // HL=0x422f

  regs.decMem8(mem, regs.hl);
  m.step(0x15cb, 11); // dec (0x422f)

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- still counting down
  m.step(0x15cc, 5);

  regs.hl = (regs.hl - 1) & 0xffff;
  m.step(0x15cd, 6); // HL=0x422e

  mem.write8(regs.hl, 0x00);
  m.step(0x15cf, 10); // (0x422e) <- 0

  regs.a = mem.read8(0x4200);
  m.step(0x15d2, 13);
  regs.rrca();
  m.step(0x15d3, 4);
  if (regs.fNC) { m.ret(11); return; } // ret nc -- (0x4200) bit0 clear
  m.step(0x15d4, 5);

  regs.a = mem.read8(0x41ef);
  m.step(0x15d7, 13);
  regs.rrca();
  m.step(0x15d8, 4);
  if (regs.fNC) { m.ret(11); return; } // ret nc -- (0x41ef) bit0 clear
  m.step(0x15d9, 5);

  regs.a = 0x01;
  m.step(0x15db, 7);

  mem.write8(0x4229, regs.a);
  m.step(0x15de, 13); // (0x4229) <- 1

  m.ret();
}

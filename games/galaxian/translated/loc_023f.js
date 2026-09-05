// SPDX-License-Identifier: GPL-3.0-only

// loc_023f  (ROM 0x023f-0x0266) — a state handler (rst-0x28 dispatch-table target @0x016e, on the 0x400a
// state index). After four subsystem calls (0x0363 setup, 0x0bbe, 0x0cc3, 0x0367) it runs a two-phase
// countdown on the 0x4008/0x4009 timer pair. Phase 1: on expiry reload (0x4008)=0xd2, call 0x0341, and
// bump 0x4241 (the ex-de-hl pair preserves HL=0x4009 across that inc). Phase 2: on expiry reload
// (0x4009)=0xd2, advance the state index (0x400a), clear 0x4058. `ret nz` holds each phase until due.
export function loc_023f(m) {
  const { regs, mem } = m;

  m.push16(0x0242);
  m.step(0x0363, 17);
  m.call(0x0363);

  m.push16(0x0245);
  m.step(0x0bbe, 17);
  m.call(0x0bbe);

  m.push16(0x0248);
  m.step(0x0cc3, 17);
  m.call(0x0cc3);

  m.push16(0x024b);
  m.step(0x0367, 17);
  m.call(0x0367);

  regs.hl = 0x4008;
  m.step(0x024e, 10); // phase-1 countdown timer (0x4008/0x4009 pair)

  regs.decMem8(mem, regs.hl);
  m.step(0x024f, 11); // dec (0x4008)

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- phase 1 still counting
  m.step(0x0250, 5);

  mem.write8(regs.hl, 0xd2);
  m.step(0x0252, 10); // (0x4008) <- 0xd2 reload

  regs.l = regs.inc8(regs.l);
  m.step(0x0253, 4); // HL=0x4009

  m.push16(0x0256);
  m.step(0x0341, 17);
  m.call(0x0341);

  regs.exDeHl();
  m.step(0x0257, 4); // DE=0x4009 (stash the timer ptr)

  regs.hl = 0x4241;
  m.step(0x025a, 10);

  regs.incMem8(mem, regs.hl);
  m.step(0x025b, 11); // inc (0x4241)

  regs.exDeHl();
  m.step(0x025c, 4); // HL=0x4009 again

  regs.decMem8(mem, regs.hl);
  m.step(0x025d, 11); // dec (0x4009)

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- phase 2 still counting
  m.step(0x025e, 5);

  mem.write8(regs.hl, 0xd2);
  m.step(0x0260, 10); // (0x4009) <- 0xd2 reload

  regs.l = regs.inc8(regs.l);
  m.step(0x0261, 4); // HL=0x400a

  regs.incMem8(mem, regs.hl);
  m.step(0x0262, 11); // inc (0x400a) -- advance the state index

  regs.xor(regs.a);
  m.step(0x0263, 4); // A=0

  mem.write8(0x4058, regs.a);
  m.step(0x0266, 13); // (0x4058) <- 0

  m.ret();
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_00d8  (ROM 0x00D8-0x00E5) — the VBLANK-NMI EPILOGUE. Restores the six register pairs loc_0066 saved
// on entry (pop iy/ix/hl/de/bc, then pop af last), and in between RE-ARMS the irq_enable latch
// (ld a,1; ld (0x7001),a) so the NEXT vblank asserts the NMI again — loc_0066 cleared it at 0x0072 to ack
// this one. The final `ret` pops the interrupted main-loop PC. Both NMI dispatch paths converge here: the
// rst-28 state dispatch (loc_0066 pushes 0x00d8 at 0x00ca, its target rets into here) and the alternate
// handler (loc_1bcd pushes 0x00d8 at 0x1bd0, its handler rets into here). Without this re-arm, only the
// first NMI ever fires and the whole per-frame loop freezes.
export function loc_00d8(m) {
  const { regs, mem } = m;

  regs.iy = m.pop16();
  m.step(0x00da, 14); // pop iy

  regs.ix = m.pop16();
  m.step(0x00dc, 14); // pop ix

  regs.hl = m.pop16();
  m.step(0x00dd, 10); // pop hl

  regs.de = m.pop16();
  m.step(0x00de, 10); // pop de

  regs.bc = m.pop16();
  m.step(0x00df, 10); // pop bc

  regs.a = 0x01;
  m.step(0x00e1, 7); // ld a,0x01

  mem.write8(0x7001, regs.a, 10);
  m.step(0x00e4, 13); // ld (0x7001),a -- irq_enable latch <- 1 (re-arm; NMI back ON for the next vblank)

  regs.af = m.pop16();
  m.step(0x00e5, 10); // pop af -- restores the caller's A/F over the ld a,1

  m.ret(); // ret -- pop the interrupted main-loop PC
}

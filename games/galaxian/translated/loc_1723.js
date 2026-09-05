// SPDX-License-Identifier: GPL-3.0-only

// loc_1723  (ROM 0x1723-0x1732) — phase counter at 0x41cc. Decrements it; while still nonzero, tail-jumps
// into loc_1733 (the tone toggler). When it reaches 0, stores 0 back to 0x41cc and re-arms duration 0x41ce=8.
export function loc_1723(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x41cc); // 0x41cc: phase counter
  m.step(0x1726, 13);

  regs.a = regs.dec8(regs.a);
  m.step(0x1727, 4);

  if (regs.fNZ) {
    // jp nz,0x1733 (taken) -- still counting: tail into loc_1733
    m.step(0x1733, 10);
    return m.call(0x1733);
  }
  m.step(0x172a, 10);

  mem.write8(0x41cc, regs.a); // A == 0 here
  m.step(0x172d, 13);

  regs.a = 0x08;
  m.step(0x172f, 7);

  mem.write8(0x41ce, regs.a); // 0x41ce: re-arm duration = 8
  m.step(0x1732, 13);

  return m.ret();
}

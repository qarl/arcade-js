// SPDX-License-Identifier: GPL-3.0-only

// loc_214e  (ROM 0x214e-0x2156) — return a VRAM pointer in HL chosen by A: A==0 -> 0x5340, else 0x50e0.
export function loc_214e(m) {
  const { regs } = m;

  regs.hl = 0x5340; // VRAM
  m.step(0x2151, 10);

  regs.and(regs.a); // Z iff A==0
  m.step(0x2152, 4);

  if (regs.fZ) {
    m.ret(11); // ret z (taken): HL=0x5340
    return;
  }
  m.step(0x2153, 5); // ret z (not taken)

  regs.hl = 0x50e0; // VRAM
  m.step(0x2156, 10);

  m.ret(); // HL=0x50e0
}

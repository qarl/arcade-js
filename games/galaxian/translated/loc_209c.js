// SPDX-License-Identifier: GPL-3.0-only

// loc_209c  (ROM 0x209c-0x20a6) — if work-RAM 0x4006 is nonzero, save it into 0x40ab and tail into
// loc_20ac; otherwise branch to loc_20a7 (which re-reads the saved 0x40ab).
export function loc_209c(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4006);
  m.step(0x209f, 13); // ld a,(0x4006) -- work RAM

  regs.and(regs.a);
  m.step(0x20a0, 4); // and a -- test A

  if (regs.fZ) {
    m.step(0x20a7, 12); // jr z,0x20a7 (taken)
    return m.call(0x20a7);
  }
  m.step(0x20a2, 7); // jr z (not taken)

  mem.write8(0x40ab, regs.a);
  m.step(0x20a5, 13); // ld (0x40ab),a -- save the nonzero 0x4006

  m.step(0x20ac, 12); // jr 0x20ac
  return m.call(0x20ac);
}

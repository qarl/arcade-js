// SPDX-License-Identifier: GPL-3.0-only

// loc_1bcd  (ROM 0x1BCD-0x1BE2) — a 1-of-4 STATE DISPATCH on A. Pushes a shared epilogue return address
// (0x00d8) so whichever handler runs `ret`s into 0x00d8, then decrements A three times, branching:
//   A==1 -> jp 0x1c3a,  A==2 -> jp 0x1d28,  A not in {1,2,3} -> jp 0x0000 (reset),
//   A==3 -> ld hl,0x5800; ld a,(0x401e); FALL THROUGH into loc_1be3 (OBJRAM color fill).
// Reached by jp nz,0x1bcd from 0x0076.
//   1bcd  21 d8 00  ld hl,0x00d8      1bd0  e5        push hl       1bd1  3d        dec a
//   1bd2  ca 3a 1c  jp z,0x1c3a       1bd5  3d        dec a         1bd6  ca 28 1d  jp z,0x1d28
//   1bd9  3d        dec a             1bda  c2 00 00  jp nz,0x0000  1bdd  21 00 58  ld hl,0x5800
//   1be0  3a 1e 40  ld a,(0x401e)
export function loc_1bcd(m) {
  const { regs, mem } = m;

  regs.hl = 0x00d8;
  m.step(0x1bd0, 10); // ld hl,0x00d8 -- shared handler epilogue address

  m.push16(regs.hl);
  m.step(0x1bd1, 11); // push hl -- handlers `ret` into 0x00d8

  regs.a = regs.dec8(regs.a);
  m.step(0x1bd2, 4); // dec a -- Z iff A was 1

  if (regs.fZ) {
    m.step(0x1c3a, 10); // jp z,0x1c3a (taken)
    return m.call(0x1c3a);
  }
  m.step(0x1bd5, 10); // jp z,0x1c3a (not taken)

  regs.a = regs.dec8(regs.a);
  m.step(0x1bd6, 4); // dec a -- Z iff A was 2

  if (regs.fZ) {
    m.step(0x1d28, 10); // jp z,0x1d28 (taken)
    return m.call(0x1d28);
  }
  m.step(0x1bd9, 10); // jp z,0x1d28 (not taken)

  regs.a = regs.dec8(regs.a);
  m.step(0x1bda, 4); // dec a -- Z iff A was 3

  if (regs.fNZ) {
    m.step(0x0000, 10); // jp nz,0x0000 (taken) -- A not in {1,2,3} -> reset
    return m.call(0x0000);
  }
  m.step(0x1bdd, 10); // jp nz,0x0000 (not taken) -- A was 3

  regs.hl = 0x5800;
  m.step(0x1be0, 10); // ld hl,0x5800 -- OBJRAM base

  regs.a = mem.read8(0x401e);
  m.step(0x1be3, 13); // ld a,(0x401e) -- fill seed

  // fall-through into loc_1be3 (OBJRAM color-ramp fill) -- delegate, do not inline
  return m.call(0x1be3);
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_1a9a  (ROM 0x1a9a-0x1a9f) — sets up the work-RAM walking-pattern self-test: HL=0x4000 (RAM base),
// B=4 (four 0x100-byte pages), A=C (the current test seed passed in C), then falls through into loc_1aa0
// (the write/verify inner loop, a SEPARATE routine not in this batch). Entry: C=0x20 (from loc_1a90).
//   1a9a  21 00 40  ld hl,0x4000
//   1a9d  06 04     ld b,0x04
//   1a9f  79        ld a,c
export function loc_1a9a(m) {
  const { regs } = m;

  regs.hl = 0x4000;
  m.step(0x1a9d, 10); // ld hl,0x4000

  regs.b = 0x04;
  m.step(0x1a9f, 7); // ld b,0x04

  regs.a = regs.c;
  m.step(0x1aa0, 4); // ld a,c (no flags)

  // fall-through into loc_1aa0 (the RAM walking-pattern write/verify loop) -- separate routine, delegate
  return m.call(0x1aa0);
}

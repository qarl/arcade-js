// SPDX-License-Identifier: GPL-3.0-only

// loc_1aca  (ROM 0x1aca-0x1acf) — sets up the VIDEORAM walking-pattern self-test: HL=0x5000 (VRAM base),
// B=4 (four 0x100-byte pages), A=C (the current test seed), then falls through into loc_1ad0 (the VRAM
// write loop, a SEPARATE routine in this batch). This is the VIDEORAM twin of loc_1a9a. Entry: C=0x20
// (from loc_1ab1, or re-entered from the loc_1ae4 verify loop for each successive seed).
//   1aca  21 00 50  ld hl,0x5000
//   1acd  06 04     ld b,0x04
//   1acf  79        ld a,c
export function loc_1aca(m) {
  const { regs } = m;

  regs.hl = 0x5000;
  m.step(0x1acd, 10); // ld hl,0x5000 -- VIDEORAM base

  regs.b = 0x04;
  m.step(0x1acf, 7); // ld b,0x04 -- four 0x100-byte pages

  regs.a = regs.c;
  m.step(0x1ad0, 4); // ld a,c -- seed the pattern from C (no flags)

  // fall-through into loc_1ad0 (the VIDEORAM walking-pattern write loop) -- separate routine, delegate
  return m.call(0x1ad0);
}

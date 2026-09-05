// SPDX-License-Identifier: GPL-3.0-only

// loc_0048  (ROM 0x0048-0x004B) — entry of the 8-bit divide helper (A / D by repeated
// compare-subtract-shift). Clears the quotient accumulator C and sets the 8-iteration loop
// counter B, then falls through into the compare/subtract body at loc_004c (a separate routine,
// NOT in this batch). Called from 0x11d0 and 0x1218.
//   0048  0e 00     ld c,0x00
//   004a  06 08     ld b,0x08
//   -> fall through to loc_004c
export function loc_0048(m) {
  const { regs } = m;

  regs.c = 0x00;
  m.step(0x004a, 7); // ld c,0x00 -- quotient accumulator (no flags)

  regs.b = 0x08;
  m.step(0x004c, 7); // ld b,0x08 -- 8-iteration loop counter (no flags)

  // fall-through into loc_004c (the compare/subtract body) -- separate routine, delegate
  return m.call(0x004c);
}

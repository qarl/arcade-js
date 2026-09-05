// SPDX-License-Identifier: GPL-3.0-only

// loc_11d0  (ROM 0x11d0-0x11df) — slope-to-octant: divide A/D via loc_0048 (quotient in C), clamp a
// negative quotient to 0x80, then return the top 3 bits of it as a 0-7 octant in A ((C>>5)&7). Interior
// label loc_11da (the jp-p target) inlined. Called from loc_11b0.
export function loc_11d0(m) {
  const { regs } = m;

  m.push16(0x11d3);
  m.step(0x0048, 17);
  m.call(0x0048); // A/D divide -> quotient in C

  regs.a = regs.c;
  m.step(0x11d4, 4);

  regs.and(regs.a); // and a -- test sign of the quotient
  m.step(0x11d5, 4);

  if (regs.fP) {
    m.step(0x11da, 10); // jp p,0x11da (taken) -- quotient non-negative
  } else {
    m.step(0x11d8, 10); // jp p (not taken; jp cc is 10T either way)
    regs.a = 0x80; // clamp: steepest/negative slope
    m.step(0x11da, 7);
  }

  // loc_11da:
  regs.rlca();
  m.step(0x11db, 4);
  regs.rlca();
  m.step(0x11dc, 4);
  regs.rlca();
  m.step(0x11dd, 4);

  regs.and(0x07); // A = octant 0-7 (top 3 bits of the quotient)
  m.step(0x11df, 7);

  m.ret();
}

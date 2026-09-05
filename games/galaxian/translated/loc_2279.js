// SPDX-License-Identifier: GPL-3.0-only

// loc_2279  (ROM 0x2279-0x228f) — BCD-digit -> VRAM tile with leading-zero blanking. A holds a nibble; the
// tile is digit+0x90 (0x90-0x99 = '0'-'9'). C is the blanking state: while a zero digit arrives with C!=0 it
// is blanked (A=0x80 -> 0x80+0x90 wraps to tile 0x10) and C is dec'd; the first non-zero digit clears C.
// Stores the tile at (IX) and advances IX by DE. Called per nibble from loc_2269. Interior labels 0x2281,
// 0x2288 inlined.
export function loc_2279(m) {
  const { regs, mem } = m;

  regs.and(0x0f);
  m.step(0x227b, 7); // and 0x0f -- isolate the digit nibble (sets Z)

  if (regs.fNZ) {
    // jr z,0x2281 not taken -- non-zero digit
    m.step(0x227d, 7);
    regs.c = 0x00;
    m.step(0x227f, 7); // ld c,0x00 -- stop blanking leading zeros
    m.step(0x2288, 12); // jr 0x2288
  } else {
    m.step(0x2281, 12); // jr z,0x2281 (taken) -- digit is 0
    // loc_2281:
    regs.a = regs.c;
    m.step(0x2282, 4);
    regs.and(regs.a);
    m.step(0x2283, 4); // and a -- still blanking? (C==0 -> draw the '0')
    if (regs.fNZ) {
      // jr z,0x2288 not taken -- blank this leading zero
      m.step(0x2285, 7);
      regs.a = 0x80;
      m.step(0x2287, 7); // ld a,0x80 -- blank base (0x80+0x90 wraps to tile 0x10)
      regs.c = regs.dec8(regs.c);
      m.step(0x2288, 4); // dec c
    } else {
      m.step(0x2288, 12); // jr z,0x2288 (taken) -- draw the '0'
    }
  }

  // loc_2288:
  regs.add(0x90);
  m.step(0x228a, 7); // add a,0x90 -- tile = digit+0x90
  mem.write8((regs.ix + 0x00) & 0xffff, regs.a);
  m.step(0x228d, 19); // ld (ix+0),a -- write the tile
  regs.addIx(regs.de);
  m.step(0x228f, 15); // add ix,de -- next cell
  m.ret();
}

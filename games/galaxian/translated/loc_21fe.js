// SPDX-License-Identifier: GPL-3.0-only

// loc_21fe  (ROM 0x21fe-0x2230) — clear a score/slot entry selected by index A. A<3 picks a base+scratch pair
// (0:0x40a2/0x40ad, 1:0x40a5/0x40ae, 2:0x40a8/self), zeroes 3 bytes at the base + 1 byte at the scratch, then
// tail-jumps to loc_2231. A>=3 recurses (loc_2228) over indices A-1..0.
export function loc_21fe(m) {
  const { regs, mem } = m;

  regs.cp(0x03);
  m.step(0x2200, 7); // cp 0x03

  if (regs.fNC) {
    m.step(0x2228, 12); // jr nc,0x2228 (taken)
    for (;;) {
      // loc_2228: recurse over the lower indices
      regs.a = regs.dec8(regs.a);
      m.step(0x2229, 4); // dec a
      m.push16(regs.af);
      m.step(0x222a, 11); // push af
      m.push16(0x222d);
      m.step(0x21fe, 17); // call 0x21fe (recurse)
      m.call(0x21fe);
      regs.af = m.pop16();
      m.step(0x222e, 10); // pop af -- Z from the saved dec a
      if (regs.fZ) { m.ret(11); return; } // ret z -- index hit 0
      m.step(0x222f, 5); // ret z (not taken)
      m.step(0x2228, 12); // jr 0x2228
    }
  }
  m.step(0x2202, 7); // jr nc,0x2228 (not taken)

  m.push16(regs.af);
  m.step(0x2203, 11); // push af -- save the index
  regs.hl = 0x40a2;
  m.step(0x2206, 10); // ld hl,0x40a2
  regs.de = 0x40ad;
  m.step(0x2209, 10); // ld de,0x40ad
  regs.and(regs.a);
  m.step(0x220a, 4); // and a -- index == 0?

  if (regs.fZ) {
    m.step(0x221a, 12); // jr z,0x221a (taken) -- HL=0x40a2 DE=0x40ad
  } else {
    m.step(0x220c, 7); // jr z (not taken)
    regs.hl = 0x40a5;
    m.step(0x220f, 10); // ld hl,0x40a5
    regs.de = 0x40ae;
    m.step(0x2212, 10); // ld de,0x40ae
    regs.a = regs.dec8(regs.a);
    m.step(0x2213, 4); // dec a -- index == 1?
    if (regs.fZ) {
      m.step(0x221a, 12); // jr z,0x221a (taken) -- HL=0x40a5 DE=0x40ae
    } else {
      m.step(0x2215, 7); // jr z (not taken) -- index == 2
      regs.hl = 0x40a8;
      m.step(0x2218, 10); // ld hl,0x40a8
      regs.e = regs.l;
      m.step(0x2219, 4); // ld e,l
      regs.d = regs.h;
      m.step(0x221a, 4); // ld d,h -- DE = HL = 0x40a8
    }
  }

  // loc_221a: zero 3 bytes at (HL) then 1 byte at (DE)
  mem.write8(regs.hl, 0x00);
  m.step(0x221c, 10); // ld (hl),0x00
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x221d, 6); // inc hl
  mem.write8(regs.hl, 0x00);
  m.step(0x221f, 10); // ld (hl),0x00
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x2220, 6); // inc hl
  mem.write8(regs.hl, 0x00);
  m.step(0x2222, 10); // ld (hl),0x00
  regs.exDeHl();
  m.step(0x2223, 4); // ex de,hl -- HL = the scratch cell
  mem.write8(regs.hl, 0x00);
  m.step(0x2225, 10); // ld (hl),0x00
  regs.af = m.pop16();
  m.step(0x2226, 10); // pop af

  // jr 0x2231 -- tail into loc_2231
  m.step(0x2231, 12);
  return m.call(0x2231);
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_21a6  (ROM 0x21a6-0x21f7) — BCD score update. Index A -> C, rst 08 (conditional abort on (0x4007) bit0),
// then loc_2290 seeds DE=0x40a2. Adds the 3-byte BCD increment at 0x22d0+A*3 into the 3 bytes at (DE) with daa,
// derives a value (<<4) compared to (0x40ac) [call nc,0x229c], calls loc_2256, then compares the running total
// (DE, high byte first) against (0x40aa): ret c below, ret if equal; a higher total copies 3 bytes to 0x40a8
// (loc_21e9) and falls through to loc_21f8.
export function loc_21a6(m) {
  const { regs, mem } = m;

  regs.c = regs.a;
  m.step(0x21a7, 4); // ld c,a -- save index

  m.push16(0x21a8);
  m.step(0x0008, 11); // rst 0x08 -- conditional double-return on (0x4007) bit0
  m.call(0x0008);
  if (m.pc !== 0x21a8) return; // took the double-return: (0x4007) bit0 set -> skip the whole score update

  m.push16(0x21ab);
  m.step(0x2290, 17); // call 0x2290 -- DE <- 0x40a2 (score buffer)
  m.call(0x2290);

  regs.a = regs.c;
  m.step(0x21ac, 4); // ld a,c
  regs.add(regs.c);
  m.step(0x21ad, 4); // add a,c
  regs.add(regs.c);
  m.step(0x21ae, 4); // add a,c -- A = index*3
  regs.c = regs.a;
  m.step(0x21af, 4); // ld c,a
  regs.b = 0x00;
  m.step(0x21b1, 7); // ld b,0x00 -- BC = index*3

  regs.hl = 0x22d0;
  m.step(0x21b4, 10); // ld hl,0x22d0 -- BCD-increment table (ROM)
  regs.addHl(regs.bc);
  m.step(0x21b5, 11); // add hl,bc -- HL = table + index*3
  regs.and(regs.a);
  m.step(0x21b6, 4); // and a -- clear carry for the adc chain
  regs.b = 0x03;
  m.step(0x21b8, 7); // ld b,0x03

  for (;;) {
    // loc_21b8: 3-byte BCD add of the table into (DE)
    regs.a = mem.read8(regs.de);
    m.step(0x21b9, 7); // ld a,(de)
    regs.adc(mem.read8(regs.hl));
    m.step(0x21ba, 7); // adc a,(hl)
    regs.daa();
    m.step(0x21bb, 4); // daa
    mem.write8(regs.de, regs.a);
    m.step(0x21bc, 7); // ld (de),a
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x21bd, 6); // inc de
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x21be, 6); // inc hl
    if (regs.djnz() !== 0) { m.step(0x21b8, 13); continue; }
    m.step(0x21c0, 8);
    break;
  }

  regs.de = (regs.de - 1) & 0xffff;
  m.step(0x21c1, 6); // dec de
  m.push16(regs.de);
  m.step(0x21c2, 11); // push de
  regs.de = (regs.de - 1) & 0xffff;
  m.step(0x21c3, 6); // dec de
  regs.h = regs.a;
  m.step(0x21c4, 4); // ld h,a -- high byte of the total
  regs.a = mem.read8(regs.de);
  m.step(0x21c5, 7); // ld a,(de)
  regs.l = regs.a;
  m.step(0x21c6, 4); // ld l,a
  regs.addHl(regs.hl);
  m.step(0x21c7, 11); // add hl,hl
  regs.addHl(regs.hl);
  m.step(0x21c8, 11); // add hl,hl
  regs.addHl(regs.hl);
  m.step(0x21c9, 11); // add hl,hl
  regs.addHl(regs.hl);
  m.step(0x21ca, 11); // add hl,hl -- HL << 4
  regs.a = regs.h;
  m.step(0x21cb, 4); // ld a,h
  regs.hl = 0x40ac;
  m.step(0x21ce, 10); // ld hl,0x40ac
  regs.cp(mem.read8(regs.hl));
  m.step(0x21cf, 7); // cp (hl)
  if (regs.fNC) {
    m.push16(0x21d2);
    m.step(0x229c, 17); // call nc,0x229c (taken)
    m.call(0x229c);
  } else {
    m.step(0x21d2, 10); // call nc,0x229c (not taken)
  }
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x21d3, 6); // inc de
  regs.a = mem.read8(0x400d);
  m.step(0x21d6, 13); // ld a,(0x400d)
  m.push16(0x21d9);
  m.step(0x2256, 17); // call 0x2256
  m.call(0x2256);
  regs.de = m.pop16();
  m.step(0x21da, 10); // pop de
  regs.hl = 0x40aa;
  m.step(0x21dd, 10); // ld hl,0x40aa -- compare against this stored total
  regs.b = 0x03;
  m.step(0x21df, 7); // ld b,0x03

  for (;;) {
    // loc_21df: compare the new total (DE, descending) against (HL, descending)
    regs.a = mem.read8(regs.de);
    m.step(0x21e0, 7); // ld a,(de)
    regs.cp(mem.read8(regs.hl));
    m.step(0x21e1, 7); // cp (hl)
    if (regs.fC) { m.ret(11); return; } // ret c -- new total below stored
    m.step(0x21e2, 5); // ret c (not taken)
    if (regs.fNZ) { m.step(0x21e9, 12); break; } // jr nz,0x21e9 -- new total is higher
    m.step(0x21e4, 7); // jr nz (not taken)
    regs.de = (regs.de - 1) & 0xffff;
    m.step(0x21e5, 6); // dec de
    regs.hl = (regs.hl - 1) & 0xffff;
    m.step(0x21e6, 6); // dec hl
    if (regs.djnz() !== 0) { m.step(0x21df, 13); continue; }
    m.step(0x21e8, 8);
    m.ret(); // ret -- equal total, nothing to store
    return;
  }

  // loc_21e9: new high total -- copy the 3 bytes into 0x40a8
  m.push16(0x21ec);
  m.step(0x2290, 17); // call 0x2290 -- DE <- 0x40a2
  m.call(0x2290);
  regs.hl = 0x40a8;
  m.step(0x21ef, 10); // ld hl,0x40a8
  regs.b = 0x03;
  m.step(0x21f1, 7); // ld b,0x03

  for (;;) {
    // loc_21f1: copy 3 bytes (DE)->(HL)
    regs.a = mem.read8(regs.de);
    m.step(0x21f2, 7); // ld a,(de)
    mem.write8(regs.hl, regs.a);
    m.step(0x21f3, 7); // ld (hl),a
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x21f4, 6); // inc de
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x21f5, 6); // inc hl
    if (regs.djnz() !== 0) { m.step(0x21f1, 13); continue; }
    m.step(0x21f7, 8);
    break;
  }

  regs.de = (regs.de - 1) & 0xffff;
  m.step(0x21f8, 6); // dec de -- fall through to loc_21f8
  return m.call(0x21f8);
}

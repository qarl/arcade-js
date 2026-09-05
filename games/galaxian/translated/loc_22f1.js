// SPDX-License-Identifier: GPL-3.0-only

// loc_22f1  (ROM 0x22f1-0x235b) — message painter. A = message index; the top two bits of A pick the mode:
// bit7 -> blank-fill (loc_2319), bit6 -> position/coordinate setup (loc_2323), else glyph-draw (loc_230e).
// The index (masked to 0x3f, word stride) picks a record ptr from the table @0x235c (DATA); the record holds
// a VRAM dest word then the text. Cells are written up one screen ROW at a time (BC = -0x20).
export function loc_22f1(m) {
  const { regs, mem } = m;

  regs.hl = 0x235c;
  m.step(0x22f4, 10); // record-pointer table base (DATA @0x235c)

  regs.add(regs.a);
  m.step(0x22f5, 4); // add a,a -- C=old bit7, S=old bit6 select the mode below

  m.push16(regs.af);
  m.step(0x22f6, 11); // push af -- keep index*2 + its C/S past the table walk

  regs.and(0x3f);
  m.step(0x22f8, 7);

  regs.e = regs.a;
  m.step(0x22f9, 4);

  regs.d = 0x00;
  m.step(0x22fb, 7);

  regs.addHl(regs.de);
  m.step(0x22fc, 11);

  regs.e = mem.read8(regs.hl);
  m.step(0x22fd, 7);

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x22fe, 6);

  regs.d = mem.read8(regs.hl);
  m.step(0x22ff, 7); // DE = record pointer

  regs.exDeHl();
  m.step(0x2300, 4);

  regs.e = mem.read8(regs.hl);
  m.step(0x2301, 7);

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x2302, 6);

  regs.d = mem.read8(regs.hl);
  m.step(0x2303, 7);

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x2304, 6); // DE = record's VRAM dest word, HL = record+2 (text)

  regs.exDeHl();
  m.step(0x2305, 4); // HL = VRAM dest, DE = text source

  regs.bc = 0xffe0;
  m.step(0x2308, 10); // -0x20: step one screen row up per char

  regs.af = m.pop16();
  m.step(0x2309, 10);

  if (regs.fC) {
    // jr c,0x2319 -- blank-fill mode: write 0x40 until the 0x3f terminator
    m.step(0x2319, 12);
    for (;;) {
      regs.a = mem.read8(regs.de);
      m.step(0x231a, 7);
      regs.cp(0x3f);
      m.step(0x231c, 7);
      if (regs.fZ) { m.ret(11); return; } // ret z -- 0x3f ends the string
      m.step(0x231d, 5);
      mem.write8(regs.hl, 0x40);
      m.step(0x231f, 10); // VRAM cell <- 0x40 (blank tile)
      regs.de = (regs.de + 1) & 0xffff;
      m.step(0x2320, 6);
      regs.addHl(regs.bc);
      m.step(0x2321, 11);
      m.step(0x2319, 12);
    }
  }
  m.step(0x230b, 7);

  if (regs.fM) {
    // jp m,0x2323 -- position/coordinate setup (no drawing; records cursor for later)
    m.step(0x2323, 10);

    mem.write16(0x40b5, regs.hl);
    m.step(0x2326, 16); // 0x40b5 <- VRAM dest word

    regs.exDeHl();
    m.step(0x2327, 4);

    mem.write16(0x40b3, regs.hl);
    m.step(0x232a, 16); // 0x40b3 <- text source pointer

    regs.a = regs.e;
    m.step(0x232b, 4);

    regs.and(0x1f);
    m.step(0x232d, 7);

    regs.b = regs.a;
    m.step(0x232e, 4); // B = column (E & 0x1f)

    regs.add(regs.a);
    m.step(0x232f, 4);

    regs.add(0x20);
    m.step(0x2331, 7);

    regs.l = regs.a;
    m.step(0x2332, 4);

    regs.h = 0x40;
    m.step(0x2334, 7);

    mem.write16(0x40b1, regs.hl);
    m.step(0x2337, 16); // 0x40b1 <- computed WRAM cursor cell

    m.push16(regs.hl);
    m.step(0x2338, 11);

    regs.e = regs.srl(regs.e);
    m.step(0x233a, 8);

    regs.e = regs.srl(regs.e);
    m.step(0x233c, 8);

    regs.a = regs.d;
    m.step(0x233d, 4);

    regs.and(0x03);
    m.step(0x233f, 7);

    regs.rrca();
    m.step(0x2340, 4);

    regs.rrca();
    m.step(0x2341, 4);

    regs.or(regs.e);
    m.step(0x2342, 4);

    regs.and(0xf8);
    m.step(0x2344, 7);

    regs.c = regs.a;
    m.step(0x2345, 4); // C = packed row byte

    regs.hl = 0x5000;
    m.step(0x2348, 10);

    regs.a = regs.b;
    m.step(0x2349, 4);

    regs.add(regs.l);
    m.step(0x234a, 4);

    regs.l = regs.a;
    m.step(0x234b, 4); // HL = 0x5000 + column

    regs.de = 0x0020;
    m.step(0x234e, 10);

    regs.b = regs.e;
    m.step(0x234f, 4); // B = 0x20 cells

    for (;;) {
      // loc_234f -- clear a full 0x20-cell VRAM column (stride 0x20) to 0x10
      mem.write8(regs.hl, 0x10);
      m.step(0x2351, 10);
      regs.addHl(regs.de);
      m.step(0x2352, 11);
      if (regs.djnz() !== 0) { m.step(0x234f, 13); continue; }
      m.step(0x2354, 8);
      break;
    }

    regs.hl = m.pop16();
    m.step(0x2355, 10);

    mem.write8(regs.hl, regs.c);
    m.step(0x2356, 7); // WRAM cursor cell <- packed row byte

    regs.a = 0x01;
    m.step(0x2358, 7);

    mem.write8(0x40b0, regs.a);
    m.step(0x235b, 13); // 0x40b0 <- 1 (message-active flag)

    m.ret();
    return;
  }
  m.step(0x230e, 10);

  for (;;) {
    // loc_230e -- glyph-draw: each char - 0x30 is its tile code; 0x3f (-> 0x0f) ends the string
    regs.a = mem.read8(regs.de);
    m.step(0x230f, 7);
    regs.sub(0x30);
    m.step(0x2311, 7);
    regs.cp(0x0f);
    m.step(0x2313, 7);
    if (regs.fZ) { m.ret(11); return; } // ret z -- terminator
    m.step(0x2314, 5);
    mem.write8(regs.hl, regs.a);
    m.step(0x2315, 7); // VRAM cell <- tile code
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x2316, 6);
    regs.addHl(regs.bc);
    m.step(0x2317, 11);
    m.step(0x230e, 12);
  }
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_098e  (ROM 0x098e-0x0a31) — reduce a 10x6 occupancy map (rows at 0x4123, stride 0x10 across, 6 down)
// into edge/summary cells: 6 row-ORs -> 0x41ea..0x41ef, 10 column-ORs -> 0x41f3..0x41fc, then scans those
// OR-vectors for the first set bit0 from each end to build the DE bound stored at 0x4210/0x4211, and folds
// four more region-ORs (toggled by C) into the 0x4220/0x4221/0x4225/0x4226 side flags. Called from 4 sites.
export function loc_098e(m) {
  const { regs, mem } = m;

  regs.xor(regs.a);
  m.step(0x098f, 4);
  regs.de = 0x41e8;
  m.step(0x0992, 10);
  mem.write8(regs.de, regs.a); // (0x41e8)=0
  m.step(0x0993, 7);
  regs.e = regs.inc8(regs.e);
  m.step(0x0994, 4);
  mem.write8(regs.de, regs.a); // (0x41e9)=0
  m.step(0x0995, 7);
  regs.e = regs.inc8(regs.e);
  m.step(0x0996, 4);
  regs.c = 0x06;
  m.step(0x0998, 7);
  regs.hl = 0x4123;
  m.step(0x099b, 10);

  // loc_099b: 6 rows, each OR of 10 bytes (inc l), result -> DE++ (0x41ea..0x41ef); HL += 0x10 per row
  for (;;) {
    regs.b = 0x0a;
    m.step(0x099d, 7);
    regs.xor(regs.a);
    m.step(0x099e, 4);
    for (;;) { // loc_099e: OR 10 bytes
      regs.or(mem.read8(regs.hl));
      m.step(0x099f, 7);
      regs.l = regs.inc8(regs.l);
      m.step(0x09a0, 4);
      if (regs.djnz() !== 0) { m.step(0x099e, 13); continue; }
      m.step(0x09a2, 8);
      break;
    }
    mem.write8(regs.de, regs.a); // row OR
    m.step(0x09a3, 7);
    regs.e = regs.inc8(regs.e);
    m.step(0x09a4, 4);
    regs.a = regs.l;
    m.step(0x09a5, 4);
    regs.add(0x06); // L += 0x10 total (10 inc l + 6) -> next row base
    m.step(0x09a7, 7);
    regs.l = regs.a;
    m.step(0x09a8, 4);
    regs.c = regs.dec8(regs.c);
    m.step(0x09a9, 4);
    if (regs.fNZ) { m.step(0x099b, 10); continue; }
    m.step(0x09ac, 10);
    break;
  }

  regs.xor(regs.a);
  m.step(0x09ad, 4);
  mem.write8(regs.de, regs.a); // (0x41f0)=0
  m.step(0x09ae, 7);
  regs.e = regs.inc8(regs.e);
  m.step(0x09af, 4);
  mem.write8(regs.de, regs.a); // (0x41f1)=0
  m.step(0x09b0, 7);
  regs.e = regs.inc8(regs.e);
  m.step(0x09b1, 4);
  mem.write8(regs.de, regs.a); // (0x41f2)=0
  m.step(0x09b2, 7);
  regs.e = regs.inc8(regs.e);
  m.step(0x09b3, 4);
  regs.hl = 0x4123;
  m.step(0x09b6, 10);
  regs.c = 0x0a;
  m.step(0x09b8, 7);

  // loc_09b8: 10 columns, each OR of 6 bytes down (stride 0x10), result -> DE++ (0x41f3..0x41fc)
  for (;;) {
    m.push16(regs.de);
    m.step(0x09b9, 11);
    regs.de = 0x0010;
    m.step(0x09bc, 10);
    regs.b = 0x06;
    m.step(0x09be, 7);
    regs.xor(regs.a);
    m.step(0x09bf, 4);
    for (;;) { // loc_09bf: OR 6 bytes stride 0x10
      regs.or(mem.read8(regs.hl));
      m.step(0x09c0, 7);
      regs.addHl(regs.de);
      m.step(0x09c1, 11);
      if (regs.djnz() !== 0) { m.step(0x09bf, 13); continue; }
      m.step(0x09c3, 8);
      break;
    }
    regs.de = m.pop16();
    m.step(0x09c4, 10);
    mem.write8(regs.de, regs.a); // column OR
    m.step(0x09c5, 7);
    regs.e = regs.inc8(regs.e);
    m.step(0x09c6, 4);
    regs.a = regs.l;
    m.step(0x09c7, 4);
    regs.sub(0x5f); // L -= 0x5f (net +1 vs the six +0x10) -> next column
    m.step(0x09c9, 7);
    regs.l = regs.a;
    m.step(0x09ca, 4);
    regs.c = regs.dec8(regs.c);
    m.step(0x09cb, 4);
    if (regs.fNZ) { m.step(0x09b8, 10); continue; }
    m.step(0x09ce, 10);
    break;
  }

  regs.hl = 0x41fc;
  m.step(0x09d1, 10);
  regs.b = 0x0a;
  m.step(0x09d3, 7);
  regs.e = 0x22;
  m.step(0x09d5, 7);

  // loc_09d5: scan column-ORs downward (0x41fc..) for first set bit0; E = 0x22 + 0x10*index, else reset 0x22
  for (;;) {
    regs.bit(0, mem.read8(regs.hl));
    m.step(0x09d7, 12);
    if (regs.fNZ) { m.step(0x09e2, 12); break; } // found -> jr nz,0x09e2 (E kept)
    m.step(0x09d9, 7);
    regs.l = regs.dec8(regs.l);
    m.step(0x09da, 4);
    regs.a = regs.e;
    m.step(0x09db, 4);
    regs.add(0x10);
    m.step(0x09dd, 7);
    regs.e = regs.a;
    m.step(0x09de, 4);
    if (regs.djnz() !== 0) { m.step(0x09d5, 13); continue; }
    m.step(0x09e0, 8);
    regs.e = 0x22; // scan exhausted -> reset E
    m.step(0x09e2, 7);
    break;
  }

  regs.hl = 0x41f3;
  m.step(0x09e5, 10);
  regs.b = 0x0a;
  m.step(0x09e7, 7);
  regs.d = 0xe0;
  m.step(0x09e9, 7);

  // loc_09e9: scan column-ORs upward (0x41f3..) for first set bit0; D = 0xe0 - 0x10*index, else reset 0xe0
  for (;;) {
    regs.bit(0, mem.read8(regs.hl));
    m.step(0x09eb, 12);
    if (regs.fNZ) { m.step(0x09f6, 12); break; } // found -> jr nz,0x09f6 (D kept)
    m.step(0x09ed, 7);
    regs.l = regs.inc8(regs.l);
    m.step(0x09ee, 4);
    regs.a = regs.d;
    m.step(0x09ef, 4);
    regs.sub(0x10);
    m.step(0x09f1, 7);
    regs.d = regs.a;
    m.step(0x09f2, 4);
    if (regs.djnz() !== 0) { m.step(0x09e9, 13); continue; }
    m.step(0x09f4, 8);
    regs.d = 0xe0; // scan exhausted -> reset D
    m.step(0x09f6, 7);
    break;
  }

  mem.write16(0x4210, regs.de); // (0x4210)=E, (0x4211)=D -- edge bound pair
  m.step(0x09fa, 20);
  regs.hl = 0x41ea;
  m.step(0x09fd, 10);
  regs.c = 0x01;
  m.step(0x09ff, 7);
  regs.b = 0x04;
  m.step(0x0a01, 7);
  regs.xor(regs.a);
  m.step(0x0a02, 4);

  for (;;) { // loc_0a02: OR 0x41ea..0x41ed
    regs.or(mem.read8(regs.hl));
    m.step(0x0a03, 7);
    regs.l = regs.inc8(regs.l);
    m.step(0x0a04, 4);
    if (regs.djnz() !== 0) { m.step(0x0a02, 13); continue; }
    m.step(0x0a06, 8);
    break;
  }
  regs.xor(regs.c);
  m.step(0x0a07, 4);
  mem.write8(0x4221, regs.a); // side flag (^C)
  m.step(0x0a0a, 13);
  regs.xor(regs.c);
  m.step(0x0a0b, 4);
  regs.or(mem.read8(regs.hl)); // 0x41ee
  m.step(0x0a0c, 7);
  regs.l = regs.inc8(regs.l);
  m.step(0x0a0d, 4);
  regs.or(mem.read8(regs.hl)); // 0x41ef
  m.step(0x0a0e, 7);
  regs.xor(regs.c);
  m.step(0x0a0f, 4);
  mem.write8(0x4220, regs.a); // side flag (^C)
  m.step(0x0a12, 13);
  regs.hl = 0x42d0;
  m.step(0x0a15, 10);
  regs.de = 0x0020;
  m.step(0x0a18, 10);
  regs.b = 0x07;
  m.step(0x0a1a, 7);
  regs.xor(regs.a);
  m.step(0x0a1b, 4);

  for (;;) { // loc_0a1b: OR 7 bytes stride 0x20 from 0x42d0
    regs.or(mem.read8(regs.hl));
    m.step(0x0a1c, 7);
    regs.addHl(regs.de);
    m.step(0x0a1d, 11);
    if (regs.djnz() !== 0) { m.step(0x0a1b, 13); continue; }
    m.step(0x0a1f, 8);
    break;
  }
  regs.xor(regs.c);
  m.step(0x0a20, 4);
  mem.write8(0x4226, regs.a); // side flag (^C)
  m.step(0x0a23, 13);
  regs.xor(regs.c);
  m.step(0x0a24, 4);
  regs.hl = 0x42b1;
  m.step(0x0a27, 10);
  regs.b = 0x08;
  m.step(0x0a29, 7);

  for (;;) { // loc_0a29: OR 8 bytes stride 0x20 from 0x42b1
    regs.or(mem.read8(regs.hl));
    m.step(0x0a2a, 7);
    regs.addHl(regs.de);
    m.step(0x0a2b, 11);
    if (regs.djnz() !== 0) { m.step(0x0a29, 13); continue; }
    m.step(0x0a2d, 8);
    break;
  }
  regs.xor(regs.c);
  m.step(0x0a2e, 4);
  mem.write8(0x4225, regs.a); // side flag (^C)
  m.step(0x0a31, 13);

  m.ret();
}

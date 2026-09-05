// SPDX-License-Identifier: GPL-3.0-only

// loc_12b6  (ROM 0x12b6-0x12ec) — per-object proximity test, called for each of 7 structs (IX, stride 0x20
// from 0x42d0) by loc_12ac. Skips inactive objects ((ix+0) bit0 clear). Classifies (ix+3)+0x21 into two
// windows (below/at-or-above 0x05) and, in either, tests the object's (ix+4) against player pos (0x4202)
// within a band; on a hit sets event flag (0x4204)=1 and tail-jumps to loc_125e. loc_12da is the low-window
// arm (jr-c interior, inlined). No hit -> ret.
export function loc_12b6(m) {
  const { regs, mem } = m;

  regs.bit(0, mem.read8(regs.ix + 0x00), (regs.ix + 0x00) >> 8);
  m.step(0x12ba, 20); // (ix+0) bit0 = active

  if (regs.fZ) { m.ret(11); return; } // ret z -- inactive object
  m.step(0x12bb, 5);

  regs.a = mem.read8(regs.ix + 0x03);
  m.step(0x12be, 19);

  regs.add(0x21);
  m.step(0x12c0, 7);

  regs.sub(0x05);
  m.step(0x12c2, 7);

  if (regs.fC) {
    // jr c,0x12da (taken) -- low window
    m.step(0x12da, 12);

    // loc_12da (interior):
    regs.a = mem.read8(0x4202);
    m.step(0x12dd, 13); // player position
    regs.sub(mem.read8(regs.ix + 0x04));
    m.step(0x12e0, 19);
    regs.add(0x07);
    m.step(0x12e2, 7);
    regs.cp(0x0f);
    m.step(0x12e4, 7);
    if (regs.fNC) { m.ret(11); return; } // ret nc -- outside band
    m.step(0x12e5, 5);
    regs.a = 0x01;
    m.step(0x12e7, 7);
    mem.write8(0x4204, regs.a);
    m.step(0x12ea, 13); // event flag (0x4204) <- 1
    m.step(0x125e, 10);
    return m.call(0x125e); // jp 0x125e
  }
  m.step(0x12c4, 7); // jr c not taken -- high window

  regs.sub(0x0c);
  m.step(0x12c6, 7);

  if (regs.fNC) { m.ret(11); return; } // ret nc -- above the high window
  m.step(0x12c7, 5);

  regs.a = mem.read8(0x4202);
  m.step(0x12ca, 13); // player position

  regs.sub(mem.read8(regs.ix + 0x04));
  m.step(0x12cd, 19);

  regs.add(0x0a);
  m.step(0x12cf, 7);

  regs.cp(0x15);
  m.step(0x12d1, 7);

  if (regs.fNC) { m.ret(11); return; } // ret nc -- outside band
  m.step(0x12d2, 5);

  regs.a = 0x01;
  m.step(0x12d4, 7);

  mem.write8(0x4204, regs.a);
  m.step(0x12d7, 13); // event flag (0x4204) <- 1

  m.step(0x125e, 10);
  return m.call(0x125e); // jp 0x125e
}

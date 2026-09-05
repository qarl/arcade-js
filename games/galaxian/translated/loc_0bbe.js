// SPDX-License-Identifier: GPL-3.0-only

// loc_0bbe  (ROM 0x0bbe-0x0c1f) — build sprite-staging rows via loc_0c20. bit0 of (0x4018) selects a base
// color C: clear -> C=7 then 8 (two djnz loops of 3 then 5 rows); set -> C=9 then 8 (the flipped arm at
// loc_0bf2). Each row: call loc_0c20 (IX source stride 0x20, IY dest stride 4). All interior loop tops
// (loc_0bd0/0be2/0bf2/0bfe/0c10) inlined.
export function loc_0bbe(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4018);
  m.step(0x0bc1, 13); // (0x4018) -- orientation flag in bit0

  regs.rrca();
  m.step(0x0bc2, 4); // carry = bit0 of (0x4018)

  if (regs.fC) {
    m.step(0x0bf2, 12); // jr c,0x0bf2 (taken) -- flipped arm

    // loc_0bf2
    regs.ix = 0x42b0;
    m.step(0x0bf6, 14); // IX = source base

    regs.iy = 0x4060;
    m.step(0x0bfa, 14); // IY = staging dest base

    regs.b = 0x03;
    m.step(0x0bfc, 7);

    regs.c = 0x09;
    m.step(0x0bfe, 7); // C = color 9

    // loc_0bfe loop (3 rows)
    for (;;) {
      m.push16(0x0c01);
      m.step(0x0c20, 17); // call loc_0c20
      m.call(0x0c20);

      regs.de = 0x0020;
      m.step(0x0c04, 10);
      regs.addIx(regs.de);
      m.step(0x0c06, 15); // IX += 0x20

      regs.de = 0x0004;
      m.step(0x0c09, 10);
      regs.addIy(regs.de);
      m.step(0x0c0b, 15); // IY += 4

      if (regs.djnz() !== 0) {
        m.step(0x0bfe, 13);
        continue;
      }
      m.step(0x0c0d, 8);
      break;
    }

    regs.b = 0x05;
    m.step(0x0c0f, 7);

    regs.c = regs.dec8(regs.c);
    m.step(0x0c10, 4); // dec c -> 8

    // loc_0c10 loop (5 rows)
    for (;;) {
      m.push16(0x0c13);
      m.step(0x0c20, 17); // call loc_0c20
      m.call(0x0c20);

      regs.de = 0x0020;
      m.step(0x0c16, 10);
      regs.addIx(regs.de);
      m.step(0x0c18, 15); // IX += 0x20

      regs.de = 0x0004;
      m.step(0x0c1b, 10);
      regs.addIy(regs.de);
      m.step(0x0c1d, 15); // IY += 4

      if (regs.djnz() !== 0) {
        m.step(0x0c10, 13);
        continue;
      }
      m.step(0x0c1f, 8);
      break;
    }

    m.ret();
    return;
  }
  m.step(0x0bc4, 7); // jr c (not taken) -- normal arm

  regs.ix = 0x42b0;
  m.step(0x0bc8, 14); // IX = source base

  regs.iy = 0x4060;
  m.step(0x0bcc, 14); // IY = staging dest base

  regs.b = 0x03;
  m.step(0x0bce, 7);

  regs.c = 0x07;
  m.step(0x0bd0, 7); // C = color 7

  // loc_0bd0 loop (3 rows)
  for (;;) {
    m.push16(0x0bd3);
    m.step(0x0c20, 17); // call loc_0c20
    m.call(0x0c20);

    regs.de = 0x0020;
    m.step(0x0bd6, 10);
    regs.addIx(regs.de);
    m.step(0x0bd8, 15); // IX += 0x20

    regs.de = 0x0004;
    m.step(0x0bdb, 10);
    regs.addIy(regs.de);
    m.step(0x0bdd, 15); // IY += 4

    if (regs.djnz() !== 0) {
      m.step(0x0bd0, 13);
      continue;
    }
    m.step(0x0bdf, 8);
    break;
  }

  regs.b = 0x05;
  m.step(0x0be1, 7);

  regs.c = regs.inc8(regs.c);
  m.step(0x0be2, 4); // inc c -> 8

  // loc_0be2 loop (5 rows)
  for (;;) {
    m.push16(0x0be5);
    m.step(0x0c20, 17); // call loc_0c20
    m.call(0x0c20);

    regs.de = 0x0020;
    m.step(0x0be8, 10);
    regs.addIx(regs.de);
    m.step(0x0bea, 15); // IX += 0x20

    regs.de = 0x0004;
    m.step(0x0bed, 10);
    regs.addIy(regs.de);
    m.step(0x0bef, 15); // IY += 4

    if (regs.djnz() !== 0) {
      m.step(0x0be2, 13);
      continue;
    }
    m.step(0x0bf1, 8);
    break;
  }

  m.ret();
}

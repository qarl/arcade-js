// SPDX-License-Identifier: GPL-3.0-only

// loc_2569  (ROM 0x2569-0x2582) — hex-to-BCD: return A as packed BCD (0x00-0x99) of the value A held as a
// plain binary byte (0x00-0x63 in use). Low nibble is DAA-normalized; each high-nibble unit adds 0x16 (=16
// decimal) through DAA, then the low part is added back. Callers split the result into tens/units digits.
export function loc_2569(m) {
  const { regs } = m;

  regs.b = regs.a;
  m.step(0x256a, 4);

  regs.and(0x0f);
  m.step(0x256c, 7);

  regs.add(0x00);
  m.step(0x256e, 7);

  regs.daa();
  m.step(0x256f, 4);

  regs.c = regs.a;
  m.step(0x2570, 4); // C = BCD of the low nibble

  regs.a = regs.b;
  m.step(0x2571, 4);

  regs.and(0xf0);
  m.step(0x2573, 7);

  if (regs.fNZ) {
    m.step(0x2575, 7);
    regs.rrca(); m.step(0x2576, 4);
    regs.rrca(); m.step(0x2577, 4);
    regs.rrca(); m.step(0x2578, 4);
    regs.rrca(); m.step(0x2579, 4);
    regs.b = regs.a;
    m.step(0x257a, 4); // B = high-nibble count
    regs.xor(regs.a);
    m.step(0x257b, 4);
    for (;;) {
      // loc_257b -- += 16 (BCD) per high-nibble unit
      regs.add(0x16);
      m.step(0x257d, 7);
      regs.daa();
      m.step(0x257e, 4);
      if (regs.djnz() !== 0) { m.step(0x257b, 13); continue; }
      m.step(0x2580, 8);
      break;
    }
  } else {
    m.step(0x2580, 12); // jr z,0x2580
  }

  // loc_2580
  regs.add(regs.c);
  m.step(0x2581, 4);
  regs.daa();
  m.step(0x2582, 4);
  m.ret();
}

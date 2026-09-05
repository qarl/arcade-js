// SPDX-License-Identifier: GPL-3.0-only

// loc_20e1  (ROM 0x20e1-0x2103) — maps the coordinate byte in A to a VIDEORAM cell address, returning
// HL = 0x5000 + offset built from A's nibble fields. push af/pop af carries the post-`rra` A+carry out
// past the address math (adc/cpl/and/add clobber A and the flags). B/C/H/L are scratch.
export function loc_20e1(m) {
  const { regs, mem } = m;

  regs.b = regs.a; // B = the coord byte
  m.step(0x20e2, 4);

  regs.and(0x0f); // low nibble
  m.step(0x20e4, 7);

  regs.rrca();
  m.step(0x20e5, 4);
  regs.rrca();
  m.step(0x20e6, 4);

  regs.c = regs.a;
  m.step(0x20e7, 4);

  regs.and(0x03);
  m.step(0x20e9, 7);

  regs.h = regs.a; // H = high byte of the cell address
  m.step(0x20ea, 4);

  regs.a = regs.c;
  m.step(0x20eb, 4);

  regs.and(0xc0);
  m.step(0x20ed, 7);

  regs.l = regs.a; // L = low byte (partial)
  m.step(0x20ee, 4);

  regs.a = regs.b;
  m.step(0x20ef, 4);

  regs.rrca();
  m.step(0x20f0, 4);
  regs.rrca();
  m.step(0x20f1, 4);
  regs.rrca();
  m.step(0x20f2, 4);
  regs.rrca();
  m.step(0x20f3, 4);

  regs.and(0x07); // high nibble field (clears carry)
  m.step(0x20f5, 7);

  regs.c = regs.a;
  m.step(0x20f6, 4);

  regs.rra();
  m.step(0x20f7, 4);

  m.push16(regs.af); // preserve post-rra A+carry
  m.step(0x20f8, 11);

  regs.adc(regs.c);
  m.step(0x20f9, 4);

  regs.cpl();
  m.step(0x20fa, 4);

  regs.and(0x0f);
  m.step(0x20fc, 7);

  regs.add(regs.l);
  m.step(0x20fd, 4);

  regs.l = regs.a;
  m.step(0x20fe, 4);

  regs.de = 0x5000; // VIDEORAM base
  m.step(0x2101, 10);

  regs.addHl(regs.de); // HL = 0x5000 + offset
  m.step(0x2102, 11);

  regs.af = m.pop16();
  m.step(0x2103, 10);

  m.ret();
}

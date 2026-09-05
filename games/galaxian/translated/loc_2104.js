// SPDX-License-Identifier: GPL-3.0-only

// loc_2104  (ROM 0x2104-0x211c) — bias B by the work-RAM 0x425f low nibble. Saves AF; if B >= 0x70 clamps
// B=0x80 and returns (inline 210a). Else B &= 0x0f, C = ((0x425f & 0x0f) < B ? 0xff : 0), pop AF, and fall
// through into loc_211d (which folds B to a 2-bit value using that C).
export function loc_2104(m) {
  const { regs, mem } = m;

  m.push16(regs.af);
  m.step(0x2105, 11);

  regs.a = regs.b;
  m.step(0x2106, 4);

  regs.cp(0x70); // C set when B < 0x70
  m.step(0x2108, 7);

  if (regs.fNC) {
    // jr c not taken (B >= 0x70): inline 210a — clamp and return
    m.step(0x210a, 7);
    regs.b = 0x80;
    m.step(0x210c, 7);
    regs.af = m.pop16();
    m.step(0x210d, 10);
    m.ret();
    return;
  }
  m.step(0x210e, 12); // jr c,0x210e (taken)

  regs.and(0x0f);
  m.step(0x2110, 7);

  regs.b = regs.a;
  m.step(0x2111, 4);

  regs.a = mem.read8(0x425f); // scroll/offset accumulator
  m.step(0x2114, 13);

  regs.and(0x0f);
  m.step(0x2116, 7);

  regs.c = 0x00;
  m.step(0x2118, 7);

  regs.cp(regs.b); // C set when (0x425f & 0x0f) < B
  m.step(0x2119, 4);

  if (regs.fC) {
    m.step(0x211b, 7); // jr nc not taken
    regs.c = regs.dec8(regs.c); // C = 0xff
    m.step(0x211c, 4);
  } else {
    m.step(0x211c, 12); // jr nc,0x211c (taken)
  }

  regs.af = m.pop16();
  m.step(0x211d, 10); // pop af — falls through into loc_211d

  return m.call(0x211d);
}

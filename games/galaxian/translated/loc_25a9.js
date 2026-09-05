// SPDX-License-Identifier: GPL-3.0-only

// loc_25a9  (ROM 0x25a9-0x25b3) — writes a vertical tile pair at (HL): (HL)=A, then (HL+0x20)=A+2. DE=0x20
// is the stride between the two cells; DE is preserved.
export function loc_25a9(m) {
  const { regs, mem } = m;

  m.push16(regs.de);
  m.step(0x25aa, 11); // push de

  regs.de = 0x0020;
  m.step(0x25ad, 10); // ld de,0x20 -- cell-to-cell stride

  mem.write8(regs.hl, regs.a);
  m.step(0x25ae, 7); // ld (hl),a -- first tile code

  regs.add(0x02);
  m.step(0x25b0, 7); // add a,0x02

  regs.addHl(regs.de);
  m.step(0x25b1, 11); // add hl,de -- HL += 0x20

  mem.write8(regs.hl, regs.a);
  m.step(0x25b2, 7); // ld (hl),a -- second tile code (A+2), 0x20 below

  regs.de = m.pop16();
  m.step(0x25b3, 10); // pop de

  m.ret();
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_25a0  (ROM 0x25a0-0x25a6) — writes one horizontal tile pair: (HL)=A, (HL+1)=A+1, then HL+=DE and
// A+=2. Caller supplies HL (tile dest) and DE (row stride). Returns.
export function loc_25a0(m) {
  const { regs, mem } = m;

  mem.write8(regs.hl, regs.a);
  m.step(0x25a1, 7); // ld (hl),a -- tile code

  regs.a = regs.inc8(regs.a);
  m.step(0x25a2, 4);

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x25a3, 6);

  mem.write8(regs.hl, regs.a);
  m.step(0x25a4, 7); // ld (hl),a -- next tile code (A+1)

  regs.a = regs.inc8(regs.a);
  m.step(0x25a5, 4);

  regs.addHl(regs.de);
  m.step(0x25a6, 11); // add hl,de -- advance to next pair slot (A now +2)

  m.ret();
}

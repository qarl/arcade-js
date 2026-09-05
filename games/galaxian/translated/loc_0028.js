// SPDX-License-Identifier: GPL-3.0-only

// loc_0028  (ROM 0x0028-0x0032) — RST 28 vector: the STATE-DISPATCH. Followed inline by a 16-bit target
// table; A is the index. Doubles A (word stride), pops the return addr (= table base), reads table+2*A
// and `jp (hl)` to the computed target (data-driven, resolved at run time from the table).
export function loc_0028(m) {
  const { regs, mem } = m;

  regs.add(regs.a);
  m.step(0x0029, 4); // add a,a -- A = index*2 (word stride)

  regs.hl = m.pop16();
  m.step(0x002a, 10); // pop hl -- HL = inline jump-table base (the rst 28 return addr)

  regs.e = regs.a;
  m.step(0x002b, 4); // ld e,a

  regs.d = 0x00;
  m.step(0x002d, 7); // ld d,0x00 -- DE = index*2

  regs.addHl(regs.de);
  m.step(0x002e, 11); // add hl,de -- HL = table + index*2

  regs.e = mem.read8(regs.hl);
  m.step(0x002f, 7); // ld e,(hl) -- low byte of target

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0030, 6); // inc hl

  regs.d = mem.read8(regs.hl);
  m.step(0x0031, 7); // ld d,(hl) -- high byte of target

  regs.exDeHl();
  m.step(0x0032, 4); // ex de,hl -- HL = dispatch target

  // jp (hl) -- computed tail-jump to the dispatched routine (target read from the table)
  const target = regs.hl;
  m.step(target, 4);
  return m.call(target);
}

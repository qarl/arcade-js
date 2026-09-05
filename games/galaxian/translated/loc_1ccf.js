// SPDX-License-Identifier: GPL-3.0-only

// loc_1ccf  (ROM 0x1ccf-0x1cdb) — index the 5-byte-per-record descriptor table at 0x1cf6 by A (HL =
// 0x1cf6 + A*5), and set B=2 (the two 16-bit words that loc_1cdc will unstack). Called from loc_1c73 with
// A = 0..9, the decoded IN0/IN1/IN2 field selector. Falls through into loc_1cdc.
export function loc_1ccf(m) {
  const { regs } = m;

  regs.b = regs.a;
  m.step(0x1cd0, 4); // ld b,a -- keep the index for the A*5 below

  regs.add(regs.a);
  m.step(0x1cd1, 4);

  regs.add(regs.a);
  m.step(0x1cd2, 4);

  regs.add(regs.b);
  m.step(0x1cd3, 4); // add a,b -- A = index*5 (record stride)

  regs.e = regs.a;
  m.step(0x1cd4, 4);

  regs.d = 0x00;
  m.step(0x1cd6, 7); // ld d,0 -- DE = index*5

  regs.hl = 0x1cf6;
  m.step(0x1cd9, 10); // ld hl,0x1cf6 -- descriptor-table base

  regs.addHl(regs.de);
  m.step(0x1cda, 11); // add hl,de -- HL = record base

  regs.b = 0x02;
  m.step(0x1cdc, 7); // ld b,0x02 -- two words to unstack

  // fall-through into loc_1cdc (the record unstack) -- separate routine, delegate
  return m.call(0x1cdc);
}

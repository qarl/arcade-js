// SPDX-License-Identifier: GPL-3.0-only

// loc_0b77  (ROM 0x0b77-0x0b8c) — called from 0x0676. If bit0 of (0x4200) is clear, ret; else scan 14
// object entries (IX=0x4260, stride DE=5) calling the per-entry check loc_0b8d. Loop top loc_0b85 inlined.
export function loc_0b77(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4200);
  m.step(0x0b7a, 13); // (0x4200) -- enable flag in bit0

  regs.rrca();
  m.step(0x0b7b, 4); // carry = bit0 of (0x4200)

  if (regs.fNC) {
    m.ret(11); // ret nc -- disabled, bail
    return;
  }
  m.step(0x0b7c, 5); // ret nc (not taken)

  regs.ix = 0x4260;
  m.step(0x0b80, 14); // IX = object-entry base

  regs.de = 0x0005;
  m.step(0x0b83, 10); // DE = per-entry stride

  regs.b = 0x0e;
  m.step(0x0b85, 7); // B = 14 entries

  for (;;) {
    // loc_0b85 loop top
    m.push16(0x0b88);
    m.step(0x0b8d, 17); // call 0x0b8d -- per-entry check
    m.call(0x0b8d);

    regs.addIx(regs.de);
    m.step(0x0b8a, 15); // IX += 5 -- next entry

    if (regs.djnz() !== 0) {
      m.step(0x0b85, 13); // djnz (taken)
      continue;
    }
    m.step(0x0b8c, 8); // djnz (not taken)
    break;
  }

  m.ret();
}

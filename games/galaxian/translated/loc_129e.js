// SPDX-License-Identifier: GPL-3.0-only

// loc_129e  (ROM 0x129e-0x12b5) — gated by (0x4200) bit0; when set, walk B=7 object structs at IX=0x42d0
// (stride DE=0x20) and run the per-entry test loc_12b6 on each. exx brackets the call so the loop counter B
// and stride DE survive the callee's register use. Interior loop top loc_12ac inlined. Called from 0x067c.
export function loc_129e(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4200);
  m.step(0x12a1, 13);
  regs.rrca();
  m.step(0x12a2, 4); // carry = (0x4200) bit0
  if (regs.fNC) { m.ret(11); return; } // ret nc -- feature disabled
  m.step(0x12a3, 5);

  regs.ix = 0x42d0;
  m.step(0x12a7, 14); // first object struct
  regs.de = 0x0020;
  m.step(0x12aa, 10); // struct stride
  regs.b = 0x07;
  m.step(0x12ac, 7);

  for (;;) {
    // loc_12ac:
    regs.exx();
    m.step(0x12ad, 4); // stash B/DE across the call
    m.push16(0x12b0);
    m.step(0x12b6, 17); // call 0x12b6 -- per-entry test
    m.call(0x12b6);
    regs.exx();
    m.step(0x12b1, 4); // restore B/DE
    regs.addIx(regs.de);
    m.step(0x12b3, 15); // IX += 0x20 -- next struct
    if (regs.djnz() !== 0) { m.step(0x12ac, 13); continue; }
    m.step(0x12b5, 8);
    break;
  }

  m.ret();
}

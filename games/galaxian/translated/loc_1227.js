// SPDX-License-Identifier: GPL-3.0-only

// loc_1227  (ROM 0x1227-0x123e) — gated by bit0 of (0x4208): if clear, return. Otherwise walk the 7 objects
// at IX=0x42d0 (stride 0x20), calling per-entry handler 0x123f inside an exx swap. Interior loop loc_1235
// inlined; the exx pair hands the callee the alternate register bank and preserves the main B loop counter.
export function loc_1227(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4208);
  m.step(0x122a, 13); // A = (0x4208)

  regs.rrca();
  m.step(0x122b, 4); // carry = bit0

  if (regs.fNC) {
    m.ret(11); // ret nc (taken) -- disabled
    return;
  }
  m.step(0x122c, 5); // ret nc (not taken)

  regs.ix = 0x42d0;
  m.step(0x1230, 14); // object table base

  regs.de = 0x0020;
  m.step(0x1233, 10); // object stride

  regs.b = 0x07;
  m.step(0x1235, 7); // 7 objects

  for (;;) {
    // loc_1235:
    regs.exx();
    m.step(0x1236, 4); // exx -- to alt bank for the callee

    m.push16(0x1239);
    m.step(0x123f, 17); // call 0x123f -- per-object handler
    m.call(0x123f);

    regs.exx();
    m.step(0x123a, 4); // exx -- restore (B is the main loop counter again)

    regs.addIx(regs.de);
    m.step(0x123c, 15); // next object

    if (regs.djnz() !== 0) {
      m.step(0x1235, 13); // djnz (taken)
      continue;
    }
    m.step(0x123e, 8); // djnz (not taken)
    break;
  }

  m.ret();
}

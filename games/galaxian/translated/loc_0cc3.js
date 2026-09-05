// SPDX-License-Identifier: GPL-3.0-only

// loc_0cc3  (ROM 0x0cc3-0x0cd5) — per-frame update of the 8 object slots at 0x42b0 (0x20 stride). Loops
// B=8 calling loc_0cd6 on each; `exx` brackets the call so the loop counter B / stride DE / HL survive
// whatever loc_0cd6 clobbers (IX is not part of exx, so it carries the current slot across).
export function loc_0cc3(m) {
  const { regs } = m;

  regs.ix = 0x42b0;
  m.step(0x0cc7, 14); // IX = object slot base

  regs.de = 0x0020;
  m.step(0x0cca, 10); // DE = slot stride

  regs.b = 0x08;
  m.step(0x0ccc, 7); // B = 8 slots

  for (;;) {
    regs.exx();
    m.step(0x0ccd, 4); // protect B/DE/HL across the call

    m.push16(0x0cd0);
    m.step(0x0cd6, 17);
    m.call(0x0cd6);

    regs.exx();
    m.step(0x0cd1, 4);

    regs.addIx(regs.de);
    m.step(0x0cd3, 15); // advance to the next slot

    if (regs.djnz() !== 0) {
      m.step(0x0ccc, 13); // djnz 0x0ccc (taken)
      continue;
    }
    m.step(0x0cd5, 8); // djnz 0x0ccc (not taken)
    break;
  }

  m.ret();
}

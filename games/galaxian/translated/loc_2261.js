// SPDX-License-Identifier: GPL-3.0-only

// loc_2261  (ROM 0x2261-0x2278) — render 3 BCD bytes at (DE) as 6 digits into VIDEORAM (IX), high nibble
// then low nibble per byte, via loc_2279 which advances IX by DE=-0x20 each digit. HL walks the source
// downward. Reached by fall-through from loc_2256 and by tail-jump from loc_21f8.
export function loc_2261(m) {
  const { regs, mem } = m;

  regs.hl = 0xffe0;
  m.step(0x2264, 10);

  regs.exDeHl();
  m.step(0x2265, 4); // DE = -0x20 (add-ix stride); HL = BCD source ptr

  regs.b = 0x03;
  m.step(0x2267, 7); // 3 bytes

  regs.c = 0x04;
  m.step(0x2269, 7);

  for (;;) {
    regs.a = mem.read8(regs.hl);
    m.step(0x226a, 7);

    regs.rrca();
    m.step(0x226b, 4);
    regs.rrca();
    m.step(0x226c, 4);
    regs.rrca();
    m.step(0x226d, 4);
    regs.rrca();
    m.step(0x226e, 4); // 4x rrca -- high nibble down into A[3:0]

    m.push16(0x2271);
    m.step(0x2279, 17); // call 0x2279 -- emit high-nibble digit
    m.call(0x2279);

    regs.a = mem.read8(regs.hl);
    m.step(0x2272, 7);

    m.push16(0x2275);
    m.step(0x2279, 17); // call 0x2279 -- emit low-nibble digit
    m.call(0x2279);

    regs.hl = (regs.hl - 1) & 0xffff;
    m.step(0x2276, 6);

    if (regs.djnz() !== 0) {
      m.step(0x2269, 13); // djnz 0x2269 (taken)
      continue;
    }
    m.step(0x2278, 8);
    break;
  }

  m.ret();
}

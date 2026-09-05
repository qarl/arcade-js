// SPDX-License-Identifier: GPL-3.0-only

// loc_0598  (ROM 0x0598-0x05a4) — copy B=0x20 bytes from (HL) into 0x4021, stride 2 (E += 2 per byte), then
// ret. HL is set by the caller (loc_0595 seeds it 0x1d71). loc_059d is the loop top, interior (djnz only).
export function loc_0598(m) {
  const { regs, mem } = m;

  regs.de = 0x4021;
  m.step(0x059b, 10); // dest base, stride 2

  regs.b = 0x20;
  m.step(0x059d, 7); // 0x20 entries

  for (;;) {
    // loc_059d:
    regs.a = mem.read8(regs.hl);
    m.step(0x059e, 7);

    mem.write8(regs.de, regs.a);
    m.step(0x059f, 7);

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x05a0, 6);

    regs.e = regs.inc8(regs.e);
    m.step(0x05a1, 4);

    regs.e = regs.inc8(regs.e);
    m.step(0x05a2, 4); // stride 2

    if (regs.djnz() !== 0) {
      m.step(0x059d, 13); // djnz (taken)
      continue;
    }
    m.step(0x05a4, 8); // djnz (not taken)
    break;
  }

  m.ret();
}

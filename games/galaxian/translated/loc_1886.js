// SPDX-License-Identifier: GPL-3.0-only

// loc_1886  (ROM 0x1886-0x1897) — step a counter/param pair at HL. inc HL, read the counter; if 0, return
// idle. Else dec the counter, inc HL to the param, add 4, store it back and mirror it to 0x41c1, then
// clear the 0x41c0 request flag.
export function loc_1886(m) {
  const { regs, mem } = m;

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1887, 6);

  regs.a = mem.read8(regs.hl);
  m.step(0x1888, 7);

  regs.and(regs.a); // Z when (HL) counter == 0
  m.step(0x1889, 4);

  if (regs.fZ) {
    m.ret(11); // ret z -- counter idle
    return;
  }
  m.step(0x188a, 5);

  regs.decMem8(mem, regs.hl); // dec (HL) -- work-RAM RMW, carry preserved
  m.step(0x188b, 11);

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x188c, 6);

  regs.a = mem.read8(regs.hl);
  m.step(0x188d, 7);

  regs.add(0x04);
  m.step(0x188f, 7);

  mem.write8(regs.hl, regs.a); // (HL) param += 4
  m.step(0x1890, 7);

  mem.write8(0x41c1, regs.a); // 0x41c1 = param
  m.step(0x1893, 13);

  regs.xor(regs.a);
  m.step(0x1894, 4);

  mem.write8(0x41c0, regs.a); // 0x41c0 = 0 (clear request)
  m.step(0x1897, 13);

  m.ret();
}

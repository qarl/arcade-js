// SPDX-License-Identifier: GPL-3.0-only

// loc_215f  (ROM 0x215f-0x2186) — pick one of three indicator forms by A. A==0 tail-jumps to loc_219b;
// A==1 tail-jumps to loc_2187. Else A = (((A-2)<<4) cpl & 0x30) + 0xc0, then stamps four VRAM cells
// (0x51da/0x51dc/0x521a/0x521c) via 0x2585, the last as a tail-jump.
export function loc_215f(m) {
  const { regs } = m;

  regs.and(regs.a); // Z iff A==0
  m.step(0x2160, 4);

  if (regs.fZ) {
    m.step(0x219b, 12); // jr z,0x219b
    return m.call(0x219b);
  }
  m.step(0x2162, 7); // jr z not taken

  regs.a = regs.dec8(regs.a);
  m.step(0x2163, 4);

  if (regs.fZ) {
    m.step(0x2187, 12); // jr z,0x2187
    return m.call(0x2187);
  }
  m.step(0x2165, 7); // jr z not taken

  regs.a = regs.dec8(regs.a);
  m.step(0x2166, 4);

  regs.add(regs.a);
  m.step(0x2167, 4);
  regs.add(regs.a);
  m.step(0x2168, 4);
  regs.add(regs.a);
  m.step(0x2169, 4);
  regs.add(regs.a);
  m.step(0x216a, 4); // A = (A-2) << 4

  regs.cpl();
  m.step(0x216b, 4);

  regs.and(0x30);
  m.step(0x216d, 7);

  regs.add(0xc0);
  m.step(0x216f, 7);

  regs.hl = 0x51da; // VRAM
  m.step(0x2172, 10);
  m.push16(0x2175);
  m.step(0x2585, 17); // call 0x2585
  m.call(0x2585);

  regs.hl = 0x51dc;
  m.step(0x2178, 10);
  m.push16(0x217b);
  m.step(0x2585, 17); // call 0x2585
  m.call(0x2585);

  regs.hl = 0x521a;
  m.step(0x217e, 10);
  m.push16(0x2181);
  m.step(0x2585, 17); // call 0x2585
  m.call(0x2585);

  regs.hl = 0x521c;
  m.step(0x2184, 10);
  m.step(0x2585, 10); // jp 0x2585 (tail)
  return m.call(0x2585);
}

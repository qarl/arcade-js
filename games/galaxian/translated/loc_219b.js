// SPDX-License-Identifier: GPL-3.0-only

// loc_219b  (ROM 0x219b-0x21a5) — calls loc_2187, then tail-jumps to loc_2585 to draw a 2x2 tile block
// (seed A=0x60) at VRAM 0x51fc.
export function loc_219b(m) {
  const { regs } = m;

  m.push16(0x219e);
  m.step(0x2187, 17); // call 0x2187
  m.call(0x2187);

  regs.a = 0x60;
  m.step(0x21a0, 7); // ld a,0x60 -- tile seed

  regs.hl = 0x51fc;
  m.step(0x21a3, 10); // ld hl,0x51fc -- VRAM dest

  // jp 0x2585 -- tail into the 2x2 tile-block draw
  m.step(0x2585, 10);
  return m.call(0x2585);
}

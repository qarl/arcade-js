// SPDX-License-Identifier: GPL-3.0-only

// loc_2000  (ROM 0x2000-0x2004) — game-loop entry (reached by jp 0x2000 from 0x1b79): point HL at the
// scratch region 0x40a2, set the 0x1e-byte count, fall into the clear loop loc_2005.
export function loc_2000(m) {
  const { regs } = m;

  regs.hl = 0x40a2;
  m.step(0x2003, 10); // ld hl,0x40a2 -- scratch region base (0x40a2-0x40bf)

  regs.b = 0x1e;
  m.step(0x2005, 7); // ld b,0x1e -- 30 bytes to clear

  // fall-through into loc_2005 (the clear loop) -- delegate
  return m.call(0x2005);
}

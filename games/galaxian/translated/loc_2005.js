// SPDX-License-Identifier: GPL-3.0-only

// loc_2005  (ROM 0x2005-0x2009) — clear loop: store 0x00 to (HL) for B bytes (HL/B seeded by loc_2000),
// then fall into the dispatch loop loc_200a.
export function loc_2005(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_2005:
    mem.write8(regs.hl, 0x00);
    m.step(0x2007, 10); // ld (hl),0x00 -- clear scratch byte (work RAM)

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x2008, 6); // inc hl

    if (regs.djnz() !== 0) {
      m.step(0x2005, 13); // djnz 0x2005 (taken)
      continue;
    }
    m.step(0x200a, 8); // djnz 0x2005 (not taken)
    break;
  }

  // fall-through into loc_200a (the dispatch loop) -- delegate
  return m.call(0x200a);
}

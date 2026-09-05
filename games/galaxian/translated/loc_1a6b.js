// SPDX-License-Identifier: GPL-3.0-only

// loc_1a6b  (ROM 0x1A6B-0x1A75) — the OBJRAM-clear loop of the cold-boot wipe. Zeroes one 256-byte
// page starting at HL (=0x5800, OBJRAM: scroll/color/sprites/bullets) with A (=0), then reloads A=0,
// points HL at the 0x6000 latch block, sets B=4 and falls through into the latch-clear loop at
// loc_1a76.
//   1a6b  77        ld (hl),a
//   1a6c  2c        inc l
//   1a6d  c2 6b 1a  jp nz,0x1a6b
//   1a70  af        xor a
//   1a71  21 00 60  ld hl,0x6000
//   1a74  06 04     ld b,0x04
export function loc_1a6b(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1a6b:
    mem.write8(regs.hl, regs.a);
    m.step(0x1a6c, 7); // ld (hl),a -- clear one OBJRAM byte

    regs.l = regs.inc8(regs.l);
    m.step(0x1a6d, 4); // inc l -- Z when the page wraps (L back to 0)

    if (regs.fNZ) {
      m.step(0x1a6b, 10); // jp nz,0x1a6b (taken) -- next OBJRAM byte
      continue;
    }
    m.step(0x1a70, 10); // jp nz,0x1a6b (not taken) -- OBJRAM (0x5800-0x58FF) cleared
    break;
  }

  regs.xor(regs.a);
  m.step(0x1a71, 4); // xor a -- A=0 (latch clear value)

  regs.hl = 0x6000;
  m.step(0x1a74, 10); // ld hl,0x6000 -- point at the 0x6000 latch block

  regs.b = 0x04;
  m.step(0x1a76, 7); // ld b,0x04 -- 4 latches (start lamps / coin lock / coin count)

  // fall-through into loc_1a76 (the latch-clear loop) -- delegate, do not inline
  return m.call(0x1a76);
}

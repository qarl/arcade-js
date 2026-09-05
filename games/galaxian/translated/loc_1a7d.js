// SPDX-License-Identifier: GPL-3.0-only

// loc_1a7d  (ROM 0x1a7d-0x1a86) — part of the cold-boot hardware wipe reached from the 0x1a55 init chain.
// Stores A (=1 on entry) into the four 0x6000-block sound LFO-freq latches (0x6004-0x6007) via a B-counted
// loop, then reloads A=0 / B=8 / HL=0x6800 and falls through into loc_1a87 (the 0x6800 sound_w clear).
// Entry: HL=0x6004, B=4, A=1 (from the 0x1a71-0x1a7c setup).
//   1a7d  77        ld (hl),a
//   1a7e  23        inc hl
//   1a7f  10 fc     djnz 0x1a7d
//   1a81  af        xor a
//   1a82  06 08     ld b,0x08
//   1a84  21 00 68  ld hl,0x6800
export function loc_1a7d(m) {
  const { regs, mem } = m;

  // loc_1a7d: B-counted store loop over the 0x6000-block latches (hardware write, ld (hl),a busOffset=4)
  for (;;) {
    mem.write8(regs.hl, regs.a, 4);
    m.step(0x1a7e, 7); // ld (hl),a

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1a7f, 6); // inc hl (16-bit, no flags)

    if (m.regs.djnz() !== 0) {
      m.step(0x1a7d, 13); // djnz 0x1a7d (taken)
      continue;
    }
    m.step(0x1a81, 8); // djnz 0x1a7d (not taken)
    break;
  }

  regs.xor(regs.a);
  m.step(0x1a82, 4); // xor a -- A=0

  regs.b = 0x08;
  m.step(0x1a84, 7); // ld b,0x08

  regs.hl = 0x6800;
  m.step(0x1a87, 10); // ld hl,0x6800

  // fall-through into loc_1a87 (the 0x6800 sound_w clear loop) -- delegate, do not inline
  return m.call(0x1a87);
}

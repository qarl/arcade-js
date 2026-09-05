// SPDX-License-Identifier: GPL-3.0-only

// loc_1a76  (ROM 0x1A76-0x1A7C) — the 0x6000-block latch-clear loop of the cold-boot wipe. Writes A
// (=0) to the four consecutive latches 0x6000-0x6003 (start_lamp0, start_lamp1, coin_lock,
// coin_count_0), then bumps A to 1, sets B=4 and falls through into loc_1a7d (which writes A=1 to the
// four sound lfo_freq latches 0x6004-0x6007). These are hardware latch writes: `ld (hl),a` carries
// bus-cycle offset 4.
//   1a76  77        ld (hl),a
//   1a77  23        inc hl
//   1a78  10 fc     djnz 0x1a76
//   1a7a  3c        inc a
//   1a7b  06 04     ld b,0x04
export function loc_1a76(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1a76:
    mem.write8(regs.hl, regs.a, 4);
    m.step(0x1a77, 7); // ld (hl),a -- clear a 0x6000-block latch (hw write, busOffset 4)

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1a78, 6); // inc hl

    if (m.regs.djnz() !== 0) {
      m.step(0x1a76, 13); // djnz 0x1a76 (taken) -- next latch
      continue;
    }
    m.step(0x1a7a, 8); // djnz 0x1a76 (not taken) -- 0x6000-0x6003 cleared
    break;
  }

  regs.a = regs.inc8(regs.a);
  m.step(0x1a7b, 4); // inc a -- A=1 (fill value for the next latch pass)

  regs.b = 0x04;
  m.step(0x1a7d, 7); // ld b,0x04 -- 4 sound lfo_freq latches (0x6004-0x6007)

  // fall-through into loc_1a7d (the 0x6004-block latch-set loop) -- delegate, do not inline
  return m.call(0x1a7d);
}

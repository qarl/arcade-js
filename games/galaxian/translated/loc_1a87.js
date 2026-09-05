// SPDX-License-Identifier: GPL-3.0-only

// loc_1a87  (ROM 0x1a87-0x1a8f) — cold-boot hardware wipe: clears the eight 0x6800 sound_w registers with
// A (=0 on entry), then reloads B=8 / HL=0x7001 and falls through into loc_1a90 (the 0x7001 control-latch
// clear). Entry: HL=0x6800, B=8, A=0 (from loc_1a7d's tail reload).
//   1a87  77        ld (hl),a
//   1a88  23        inc hl
//   1a89  10 fc     djnz 0x1a87
//   1a8b  06 08     ld b,0x08
//   1a8d  21 01 70  ld hl,0x7001
export function loc_1a87(m) {
  const { regs, mem } = m;

  // loc_1a87: B-counted store loop over 0x6800-0x6807 sound_w (hardware write, ld (hl),a busOffset=4)
  for (;;) {
    mem.write8(regs.hl, regs.a, 4);
    m.step(0x1a88, 7); // ld (hl),a

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1a89, 6); // inc hl (16-bit, no flags)

    if (m.regs.djnz() !== 0) {
      m.step(0x1a87, 13); // djnz 0x1a87 (taken)
      continue;
    }
    m.step(0x1a8b, 8); // djnz 0x1a87 (not taken)
    break;
  }

  regs.b = 0x08;
  m.step(0x1a8d, 7); // ld b,0x08

  regs.hl = 0x7001;
  m.step(0x1a90, 10); // ld hl,0x7001

  // fall-through into loc_1a90 (the 0x7001 control-latch clear loop) -- delegate, do not inline
  return m.call(0x1a90);
}

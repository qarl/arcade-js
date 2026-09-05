// SPDX-License-Identifier: GPL-3.0-only

// loc_1a90  (ROM 0x1a90-0x1a99) — cold-boot hardware wipe: walks HL=0x7001..0x7008 storing A (=0), clearing
// the 0x7000-block control latches (0x7001 irq_enable, 0x7004 stars, 0x7006 flip_x, 0x7007 flip_y; unmapped
// 0x7002/3/5/8 drop). Then DEC A -> 0xFF into the 0x7800 sound-pitch latch, sets C=0x20 and falls through
// into loc_1a9a. Entry: HL=0x7001, B=8, A=0.
export function loc_1a90(m) {
  const { regs, mem } = m;

  // loc_1a90: B-counted store loop over the 0x7000-block latches (hardware/unmapped mix, ld (hl),a busOffset=4)
  for (;;) {
    mem.write8(regs.hl, regs.a, 4);
    m.step(0x1a91, 7); // ld (hl),a

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1a92, 6); // inc hl (16-bit, no flags)

    if (m.regs.djnz() !== 0) {
      m.step(0x1a90, 13); // djnz 0x1a90 (taken)
      continue;
    }
    m.step(0x1a94, 8); // djnz 0x1a90 (not taken)
    break;
  }

  regs.a = regs.dec8(regs.a);
  m.step(0x1a95, 4); // dec a -- A = 0x00 - 1 = 0xFF

  mem.write8(0x7800, regs.a, 10);
  m.step(0x1a98, 13); // ld (0x7800),a -- sound pitch latch (ld (nn),a busOffset=10)

  regs.c = 0x20;
  m.step(0x1a9a, 7); // ld c,0x20

  // fall-through into loc_1a9a (the work-RAM walking-pattern test setup) -- delegate, do not inline
  return m.call(0x1a9a);
}

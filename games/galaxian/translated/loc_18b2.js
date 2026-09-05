// SPDX-License-Identifier: GPL-3.0-only

// loc_18b2  (ROM 0x18b2-0x18bf) — broadcast A to the sound lfo_freq latches. Store A at 0x421f, then write it
// to 0x6004-0x6007 (the 0x6000-block regs 4-7 = lfo_freq_w), rotating A right by one bit before each of the
// four writes.
export function loc_18b2(m) {
  const { regs, mem } = m;

  mem.write8(0x421f, regs.a); // 0x421f = level (work RAM)
  m.step(0x18b5, 13);

  regs.b = 0x04;
  m.step(0x18b7, 7);

  regs.hl = 0x6004;
  m.step(0x18ba, 10);

  for (;;) {
    // loc_18ba:
    mem.write8(regs.hl, regs.a, 4); // lfo_freq latch 0x6004-0x6007; ld (hl),a busOffset 4
    m.step(0x18bb, 7);

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x18bc, 6);

    regs.rrca();
    m.step(0x18bd, 4);

    if (regs.djnz() !== 0) {
      m.step(0x18ba, 13); // djnz (taken)
      continue;
    }
    m.step(0x18bf, 8); // djnz (not taken)
    break;
  }

  m.ret();
}

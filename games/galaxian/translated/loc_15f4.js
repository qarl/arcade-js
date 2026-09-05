// SPDX-License-Identifier: GPL-3.0-only

// loc_15f4  (ROM 0x15f4-0x161a) — scan the 4 word-slots at 0x41e8 for the first byte with bit0 set; write
// the resulting (E=slot index, D=base) pair to 0x4213. (0x421b)!=0 picks the D=0x9d/E=2 base (loc_1615),
// else D=0x84/E=1. loc_1603 (loop top), loc_1610 (store+ret), loc_1615 (alt seed) are interior labels.
export function loc_15f4(m) {
  const { regs, mem } = m;

  regs.hl = 0x41e8;
  m.step(0x15f7, 10); // ld hl,0x41e8 -- slot bytes base

  regs.b = 0x04;
  m.step(0x15f9, 7); // ld b,0x04 -- 4 slots

  regs.a = mem.read8(0x421b);
  m.step(0x15fc, 13); // ld a,(0x421b)

  regs.and(regs.a);
  m.step(0x15fd, 4); // and a

  if (regs.fNZ) {
    // jr nz,0x1615 (taken) -- loc_1615: alt seed
    m.step(0x1615, 12);
    regs.e = 0x02;
    m.step(0x1617, 7); // ld e,0x02
    regs.d = 0x9d;
    m.step(0x1619, 7); // ld d,0x9d
    m.step(0x1603, 12); // jr 0x1603
  } else {
    m.step(0x15ff, 7); // jr nz,0x1615 (not taken)
    regs.e = 0x01;
    m.step(0x1601, 7); // ld e,0x01
    regs.d = 0x84;
    m.step(0x1603, 7); // ld d,0x84
  }

  for (;;) {
    // loc_1603:
    regs.bit(0, mem.read8(regs.hl));
    m.step(0x1605, 12); // bit 0,(hl)

    if (regs.fNZ) {
      m.step(0x1610, 12); // jr nz,0x1610 (taken)
      break;
    }
    m.step(0x1607, 7); // jr nz,0x1610 (not taken)

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x1608, 6); // inc hl

    regs.bit(0, mem.read8(regs.hl));
    m.step(0x160a, 12); // bit 0,(hl)

    if (regs.fNZ) {
      m.step(0x1610, 12); // jr nz,0x1610 (taken)
      break;
    }
    m.step(0x160c, 7); // jr nz,0x1610 (not taken)

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x160d, 6); // inc hl

    regs.e = regs.inc8(regs.e);
    m.step(0x160e, 4); // inc e -- next slot index

    if (regs.djnz() !== 0) {
      m.step(0x1603, 13); // djnz 0x1603 (taken)
      continue;
    }
    m.step(0x1610, 8); // djnz 0x1603 (not taken) -> loc_1610
    break;
  }

  // loc_1610:
  mem.write16(0x4213, regs.de);
  m.step(0x1614, 20); // ld (0x4213),de -- (E=slot,D=base) result pair

  m.ret();
}

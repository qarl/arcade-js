// SPDX-License-Identifier: GPL-3.0-only

// loc_0646  (ROM 0x0646-0x0660) — unpack a packed bitmask at (DE) into one-byte-per-bit flags at HL=0x4100.
// Setup B=0x10 rows, C=0x01 walking-1 mask, then the loop (0x064d/0653/065c, all interior) walks each
// source byte's 8 bits: write 1 to (HL) when the bit is set, 0 when clear, advancing HL per bit and DE per
// byte. Call target; callers pass DE = a bitmask source.
export function loc_0646(m) {
  const { regs, mem } = m;

  regs.hl = 0x4100;
  m.step(0x0649, 10);

  regs.b = 0x10;
  m.step(0x064b, 7);

  regs.c = 0x01;
  m.step(0x064d, 7); // fall into the bit-scatter loop (loc_064d/0653/065c inlined)

  for (;;) {
    // loc_064d:
    regs.a = mem.read8(regs.de);
    m.step(0x064e, 7); // ld a,(de)

    regs.and(regs.c);
    m.step(0x064f, 4); // and c -- test the current bit

    if (regs.fZ) {
      m.step(0x065c, 12); // jr z,0x065c (taken) -- bit clear
      // loc_065c:
      mem.write8(regs.hl, 0x00);
      m.step(0x065e, 10); // ld (hl),0x00
      m.step(0x0653, 10); // jp 0x0653
    } else {
      m.step(0x0651, 7); // jr z (not taken) -- bit set
      mem.write8(regs.hl, 0x01);
      m.step(0x0653, 10); // ld (hl),0x01
    }

    // loc_0653:
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0654, 6); // inc hl -- next output cell

    regs.c = regs.rlc(regs.c);
    m.step(0x0656, 8); // rlc c -- advance mask; carry set once past bit 7

    if (regs.fNC) {
      m.step(0x064d, 12); // jr nc,0x064d (taken) -- more bits in this byte
      continue;
    }
    m.step(0x0658, 7); // jr nc (not taken)

    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x0659, 6); // inc de -- next source byte

    if (regs.djnz() !== 0) {
      m.step(0x064d, 13); // djnz 0x064d (taken)
      continue;
    }
    m.step(0x065b, 8); // djnz (not taken)
    break;
  }

  m.ret();
}

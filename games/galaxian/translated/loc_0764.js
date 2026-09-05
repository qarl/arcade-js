// SPDX-License-Identifier: GPL-3.0-only

// loc_0764  (ROM 0x0764-0x077a) — bit-packer. Reads bit0 of each of 128 flag bytes at 0x4100..0x417f and
// packs them, LSB-first, into a 16-byte bitmap at (de): 16 outer passes, each assembling 8 flags into A via
// the rotating mask C (0x01<<i), storing A to (de) once C wraps past bit7. Interior labels 0x076b (outer
// top), 0x076c (inner top), 0x0771 (jr-z merge) are inlined. Called from loc_073d/loc_082b.
export function loc_0764(m) {
  const { regs, mem } = m;

  regs.hl = 0x4100;
  m.step(0x0767, 10); // ld hl,0x4100 -- flag source

  regs.b = 0x10;
  m.step(0x0769, 7); // ld b,0x10 -- 16 output bytes

  regs.c = 0x01;
  m.step(0x076b, 7); // ld c,0x01 -- bit mask, LSB first

  for (;;) {
    // 0x076b (outer top)
    regs.xor(regs.a);
    m.step(0x076c, 4); // xor a -- clear the assembled byte

    for (;;) {
      // 0x076c (inner top)
      regs.bit(0, mem.read8(regs.hl)); // Z = flag bit0 clear
      m.step(0x076e, 12); // bit 0,(hl)

      if (regs.fNZ) {
        m.step(0x0770, 7); // jr z,0x0771 (not taken) -- flag set
        regs.or(regs.c);
        m.step(0x0771, 4); // or c -- set this position's bit
      } else {
        m.step(0x0771, 12); // jr z,0x0771 (taken) -- flag clear
      }

      // 0x0771
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x0772, 6); // inc hl

      regs.c = regs.rlc(regs.c);
      m.step(0x0774, 8); // rlc c -- carry set once mask wraps past bit7

      if (regs.fNC) {
        m.step(0x076c, 12); // jr nc,0x076c (taken) -- more bits in this byte
        continue;
      }
      m.step(0x0776, 7); // jr nc,0x076c (not taken)
      break;
    }

    mem.write8(regs.de, regs.a); // (de) <- assembled 8-bit bitmap
    m.step(0x0777, 7); // ld (de),a

    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x0778, 6); // inc de

    if (regs.djnz() !== 0) {
      m.step(0x076b, 13); // djnz 0x076b (taken)
      continue;
    }
    m.step(0x077a, 8); // djnz 0x076b (not taken)
    break;
  }

  m.ret();
}

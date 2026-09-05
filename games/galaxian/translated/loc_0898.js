// SPDX-License-Identifier: GPL-3.0-only

// loc_0898  (ROM 0x0898-0x08bb, incl. arm 0x08b1) — call loc_08bc (updates 0x4208 pair), then load the
// coord word HL=(0x4209). Bit0 of (0x4018), shifted into carry by rrca, picks the X formula: carry ->
// arm 0x08b1 stores (L-1, ~H); else stores (~L+0xfc, ~H) to (0x409f)/(0x409d).
export function loc_0898(m) {
  const { regs, mem } = m;

  m.push16(0x089b);
  m.step(0x08bc, 17); // call 0x08bc
  m.call(0x08bc);

  regs.hl = mem.read16(0x4209);
  m.step(0x089e, 16); // ld hl,(0x4209) -- coord word

  regs.a = mem.read8(0x4018);
  m.step(0x08a1, 13); // ld a,(0x4018)

  regs.rrca();
  m.step(0x08a2, 4); // rrca -- old bit0 -> carry

  if (regs.fC) {
    m.step(0x08b1, 12); // jr c,0x08b1 (taken)

    // loc_08b1:
    regs.a = regs.l;
    m.step(0x08b2, 4); // ld a,l

    regs.a = regs.dec8(regs.a);
    m.step(0x08b3, 4); // dec a

    mem.write8(0x409f, regs.a);
    m.step(0x08b6, 13); // ld (0x409f),a

    regs.a = regs.h;
    m.step(0x08b7, 4); // ld a,h

    regs.cpl();
    m.step(0x08b8, 4); // cpl

    mem.write8(0x409d, regs.a);
    m.step(0x08bb, 13); // ld (0x409d),a

    m.ret();
    return;
  }
  m.step(0x08a4, 7); // jr c,0x08b1 (not taken)

  regs.a = regs.l;
  m.step(0x08a5, 4); // ld a,l

  regs.cpl();
  m.step(0x08a6, 4); // cpl

  regs.add(0xfc);
  m.step(0x08a8, 7); // add a,0xfc

  mem.write8(0x409f, regs.a);
  m.step(0x08ab, 13); // ld (0x409f),a

  regs.a = regs.h;
  m.step(0x08ac, 4); // ld a,h

  regs.cpl();
  m.step(0x08ad, 4); // cpl

  mem.write8(0x409d, regs.a);
  m.step(0x08b0, 13); // ld (0x409d),a

  m.ret();
}

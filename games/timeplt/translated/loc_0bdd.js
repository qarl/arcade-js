// SPDX-License-Identifier: GPL-3.0-only

// loc_0bdd  (ROM 0x0BDD-0x0BF1)
export function loc_0bdd(m) {
  const { regs, mem } = m;

  regs.hl = 0x0c50;
  m.step(0x0be0, 10); // 0bdd  ld hl,0x0c50
  m.push16(0x0be3);
  m.step(0x018c, 17); // 0be0  call 0x018c
  m.call(0x018c);

  regs.exDeHl();
  m.step(0x0be4, 4); // 0be3  ex de,hl
  regs.e = mem.read8(regs.hl);
  m.step(0x0be5, 7); // 0be4  ld e,(hl)
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0be6, 6); // 0be5  inc hl
  regs.d = mem.read8(regs.hl);
  m.step(0x0be7, 7); // 0be6  ld d,(hl)
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0be8, 6); // 0be7  inc hl
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0be9, 6); // 0be8  inc hl -- steps OVER the colour byte

  for (;;) {
    regs.a = mem.read8(regs.hl);
    m.step(0x0bea, 7); // 0be9  ld a,(hl)
    regs.cp(0xb9);
    m.step(0x0bec, 7); // 0bea  cp 0xb9

    if (regs.fZ) { m.ret(11); return; } // 0bec  ret z (taken) -- terminator
    m.step(0x0bed, 5); // 0bec  ret z (not taken)

    mem.write8(regs.de, regs.a, 4);
    m.step(0x0bee, 7); // 0bed  ld (de),a -- the glyph itself
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0bef, 6); // 0bee  inc hl

    m.push16(0x0bf0);
    m.step(0x0020, 11); // 0bef  rst 0x20 -- DE -= 0x20, one row
    m.call(0x0020);

    m.step(0x0be9, 12); // 0bf0  jr 0x0be9
  }
}

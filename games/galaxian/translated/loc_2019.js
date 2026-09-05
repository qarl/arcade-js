// SPDX-License-Identifier: GPL-3.0-only

// loc_2019  (ROM 0x2019-0x202b) — decode the ready slot: low nibble -> BC handler index; stamp this slot
// byte 0xff, read E from the next byte then stamp it 0xff too; advance the pointer past both, and if it
// dropped below 0xc0 wrap it back to 0xc0. Falls into loc_202c.
export function loc_2019(m) {
  const { regs, mem } = m;

  regs.and(0x0f);
  m.step(0x201b, 7); // and 0x0f -- handler index (low nibble)

  regs.c = regs.a;
  m.step(0x201c, 4); // ld c,a

  regs.b = 0x00;
  m.step(0x201e, 7); // ld b,0x00 -- BC = index

  mem.write8(regs.hl, 0xff);
  m.step(0x2020, 10); // ld (hl),0xff -- retire this slot byte

  regs.l = regs.inc8(regs.l);
  m.step(0x2021, 4); // inc l

  regs.e = mem.read8(regs.hl);
  m.step(0x2022, 7); // ld e,(hl) -- E = slot's second byte (handler arg)

  mem.write8(regs.hl, 0xff);
  m.step(0x2024, 10); // ld (hl),0xff -- retire it too

  regs.l = regs.inc8(regs.l);
  m.step(0x2025, 4); // inc l

  regs.a = regs.l;
  m.step(0x2026, 4); // ld a,l -- advanced pointer

  regs.cp(0xc0);
  m.step(0x2028, 7); // cp 0xc0

  if (regs.fNC) {
    m.step(0x202c, 12); // jr nc,0x202c (taken) -- pointer still >= 0xc0
    return m.call(0x202c);
  }
  m.step(0x202a, 7); // jr nc (not taken)

  regs.a = 0xc0;
  m.step(0x202c, 7); // ld a,0xc0 -- wrap pointer to list base

  // fall-through into loc_202c -- delegate
  return m.call(0x202c);
}

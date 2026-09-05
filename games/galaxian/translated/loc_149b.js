// SPDX-License-Identifier: GPL-3.0-only

// loc_149b  (ROM 0x149b-0x14bd) — activate the secondary object slot at IY: bail if IY[0] or IY[1] is
// already live (bit0 set), else clear the trigger flag (HL), mark IY[0]=1 (alive) / IY[2]=0, copy IX[6]
// into IY[6], stash the trigger index L into IY[7], set DE=0x0100|L, and tail-jump into loc_08f2 (queue).
export function loc_149b(m) {
  const { regs, mem } = m;

  regs.bit(0, mem.read8(regs.iy + 0x00), (regs.iy + 0x00) >> 8);
  m.step(0x149f, 20); // bit 0,(iy+0) -- slot cell 0 already live?
  if (regs.fNZ) { m.ret(11); return; } // ret nz (taken)
  m.step(0x14a0, 5); // ret nz (not taken)

  regs.bit(0, mem.read8(regs.iy + 0x01), (regs.iy + 0x01) >> 8);
  m.step(0x14a4, 20); // bit 0,(iy+1) -- slot cell 1 already live?
  if (regs.fNZ) { m.ret(11); return; } // ret nz (taken)
  m.step(0x14a5, 5); // ret nz (not taken)

  mem.write8(regs.hl, 0x00);
  m.step(0x14a7, 10); // ld (hl),0x00 -- consume the trigger flag

  mem.write8(regs.iy + 0x00, 0x01);
  m.step(0x14ab, 19); // ld (iy+0),0x01 -- mark slot alive

  mem.write8(regs.iy + 0x02, 0x00);
  m.step(0x14af, 19); // ld (iy+2),0x00

  regs.a = mem.read8(regs.ix + 0x06);
  m.step(0x14b2, 19); // ld a,(ix+6)

  mem.write8(regs.iy + 0x06, regs.a);
  m.step(0x14b5, 19); // ld (iy+6),a -- inherit IX[6]

  mem.write8(regs.iy + 0x07, regs.l);
  m.step(0x14b8, 19); // ld (iy+7),l -- remember source trigger index

  regs.d = 0x01;
  m.step(0x14ba, 7); // ld d,0x01

  regs.e = regs.l;
  m.step(0x14bb, 4); // ld e,l -- DE = 0x0100|L

  m.step(0x08f2, 10); // jp 0x08f2 -- tail into the queue/spawn routine
  return m.call(0x08f2);
}

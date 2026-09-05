// SPDX-License-Identifier: GPL-3.0-only

// loc_08bc  (ROM 0x08bc-0x08e4) — service the 0x4208 block; called from 0x0898. If gate bit0 of 0x4208 is
// set: counter (0x4209) -= 4, and once the result drops below 0x12 raise flag (0x420b)=1. If the gate is
// clear (interior loc_08d3): reset (0x4209)=0xdc, then set field (0x420a) from (0x4202) when (0x4200) bit0
// is set, else (0x420a)=0 (interior loc_08e2). All arms ret.
export function loc_08bc(m) {
  const { regs, mem } = m;

  regs.hl = 0x4208;
  m.step(0x08bf, 10); // ld hl,0x4208 -- gate cell

  regs.bit(0, mem.read8(regs.hl));
  m.step(0x08c1, 12); // bit 0,(hl) -- Z when gate clear

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x08c2, 6); // inc hl -- HL=0x4209 (counter)

  if (regs.fZ) {
    // jr z,0x08d3 (taken) -- interior arm loc_08d3
    m.step(0x08d3, 12);

    mem.write8(regs.hl, 0xdc);
    m.step(0x08d5, 10); // ld (hl),0xdc -- reset counter (0x4209)

    regs.l = regs.inc8(regs.l);
    m.step(0x08d6, 4); // inc l -- HL=0x420a (field)

    regs.a = mem.read8(0x4200);
    m.step(0x08d9, 13); // ld a,(0x4200)

    regs.bit(0, regs.a);
    m.step(0x08db, 8); // bit 0,a

    if (regs.fZ) {
      // jr z,0x08e2 (taken) -- interior arm loc_08e2
      m.step(0x08e2, 12);
      mem.write8(regs.hl, 0x00);
      m.step(0x08e4, 10); // ld (hl),0x00 -- (0x420a)=0
      m.ret();
      return;
    }
    m.step(0x08dd, 7); // jr z,0x08e2 (not taken)

    regs.a = mem.read8(0x4202);
    m.step(0x08e0, 13); // ld a,(0x4202)

    mem.write8(regs.hl, regs.a);
    m.step(0x08e1, 7); // ld (hl),a -- (0x420a)=(0x4202)

    m.ret();
    return;
  }
  m.step(0x08c4, 7); // jr z,0x08d3 (not taken)

  regs.a = mem.read8(regs.hl);
  m.step(0x08c5, 7); // ld a,(hl) -- (0x4209)

  regs.sub(0x04);
  m.step(0x08c7, 7); // sub 0x04

  mem.write8(regs.hl, regs.a);
  m.step(0x08c8, 7); // ld (hl),a -- store (0x4209) -= 4

  regs.sub(0x0e);
  m.step(0x08ca, 7); // sub 0x0e

  regs.sub(0x04);
  m.step(0x08cc, 7); // sub 0x04 -- cumulative borrow when counter < 0x12

  if (regs.fNC) { m.ret(11); return; } // ret nc -- counter still >= 0x12
  m.step(0x08cd, 5); // ret nc (not taken)

  regs.a = 0x01;
  m.step(0x08cf, 7); // ld a,0x01

  mem.write8(0x420b, regs.a);
  m.step(0x08d2, 13); // ld (0x420b),a -- raise flag

  m.ret();
}

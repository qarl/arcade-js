// SPDX-License-Identifier: GPL-3.0-only

// loc_0492  (ROM 0x0492-0x04bb) — post-dispatch handler (the return target loc_03f2 pushes before its rst
// 28). On (0x4011) bit0 -> tail to loc_04f2; requires bit1 set (else ret); needs credit count (0x4002) >= 2,
// consuming 2, then blits the 0x20-byte row template @0x051b -> 0x41a0, optionally calls loc_050f on (0x401f)
// bit0, sets HL=0x0100 and falls through into loc_04bc.
export function loc_0492(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4011);
  m.step(0x0495, 13); // ld a,(0x4011) -- control/edge flags

  regs.bit(0, regs.a);
  m.step(0x0497, 8); // bit 0,a

  if (regs.fNZ) {
    // jr nz,0x04f2 (taken) -- bit0 set: tail to loc_04f2 (next batch)
    m.step(0x04f2, 12);
    return m.call(0x04f2);
  }
  m.step(0x0499, 7); // jr nz,0x04f2 (not taken)

  regs.bit(1, regs.a);
  m.step(0x049b, 8); // bit 1,a

  if (regs.fZ) { m.ret(11); return; } // ret z -- bit1 clear: nothing to do
  m.step(0x049c, 5); // ret z (not taken)

  regs.a = mem.read8(0x4002);
  m.step(0x049f, 13); // ld a,(0x4002) -- credit count

  regs.cp(0x02);
  m.step(0x04a1, 7); // cp 0x02

  if (regs.fC) { m.ret(11); return; } // ret c -- fewer than 2 credits
  m.step(0x04a2, 5); // ret c (not taken)

  regs.sub(0x02);
  m.step(0x04a4, 7); // sub 0x02 -- consume two credits

  mem.write8(0x4002, regs.a);
  m.step(0x04a7, 13); // ld (0x4002),a -- store remaining count

  regs.hl = 0x051b;
  m.step(0x04aa, 10); // ld hl,0x051b -- ROM row template (data table)

  regs.de = 0x41a0;
  m.step(0x04ad, 10); // ld de,0x41a0 -- work-RAM row buffer

  regs.bc = 0x0020;
  m.step(0x04b0, 10); // ld bc,0x0020

  // ldir 0x051b->0x41a0, 0x20 bytes -- copy the row template into work RAM
  m.ldirAt(0x04b0, 0x04b2);

  regs.a = mem.read8(0x401f);
  m.step(0x04b5, 13); // ld a,(0x401f)

  regs.rrca();
  m.step(0x04b6, 4); // rrca -- carry = bit0 of (0x401f)

  if (regs.fC) {
    m.push16(0x04b9);
    m.step(0x050f, 17); // call c,0x050f (taken)
    m.call(0x050f);
  } else {
    m.step(0x04b9, 10); // call c,0x050f (not taken)
  }

  regs.hl = 0x0100;
  m.step(0x04bc, 10); // ld hl,0x0100

  // fall-through into loc_04bc (genuine routine) -- delegate
  return m.call(0x04bc);
}

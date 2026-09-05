// SPDX-License-Identifier: GPL-3.0-only

// loc_08f2  (ROM 0x08f2-0x0906) — enqueue a DE word into the 0x40xx command queue. HL = 0x40:(0x40a0)
// (0x40a0 = the queue write-head index). bit 7 of the head slot gates the write (set = slot free); if
// clear it tail-jumps to loc_090b (pop+ret, queue untouched). Otherwise stores D,E, advances the head by
// 2, clamps it up to a 0xc0 floor, and tail-jumps to loc_0908 (which commits the head, then loc_090b).
export function loc_08f2(m) {
  const { regs, mem } = m;

  m.push16(regs.hl);
  m.step(0x08f3, 11); // push hl

  regs.h = 0x40;
  m.step(0x08f5, 7); // ld h,0x40 -- HL into work-RAM page 0x40

  regs.a = mem.read8(0x40a0);
  m.step(0x08f8, 13); // ld a,(0x40a0) -- queue write-head index

  regs.l = regs.a;
  m.step(0x08f9, 4); // ld l,a -- HL = 0x40:head

  const free = regs.bit(7, mem.read8(regs.hl));
  m.step(0x08fb, 12); // bit 7,(hl) -- slot-free flag (Z when clear)

  if (!free) {
    // jr z,0x090b (taken) -- slot occupied: leave the queue alone
    m.step(0x090b, 12);
    return m.call(0x090b);
  }
  m.step(0x08fd, 7); // jr z,0x090b (not taken)

  mem.write8(regs.hl, regs.d);
  m.step(0x08fe, 7); // ld (hl),d -- entry hi byte

  regs.l = regs.inc8(regs.l);
  m.step(0x08ff, 4); // inc l

  mem.write8(regs.hl, regs.e);
  m.step(0x0900, 7); // ld (hl),e -- entry lo byte

  regs.l = regs.inc8(regs.l);
  m.step(0x0901, 4); // inc l -- head past the 2-byte entry

  regs.a = regs.l;
  m.step(0x0902, 4); // ld a,l

  regs.cp(0xc0);
  m.step(0x0904, 7); // cp 0xc0 -- head below the 0xc0 floor? (C when A<0xc0)

  if (regs.fNC) {
    // jr nc,0x0908 (taken) -- head >= 0xc0: keep it (A already = L)
    m.step(0x0908, 12);
    return m.call(0x0908);
  }
  m.step(0x0906, 7); // jr nc,0x0908 (not taken)

  regs.a = 0xc0;
  m.step(0x0908, 7); // ld a,0xc0 -- clamp head up to the 0xc0 floor
  return m.call(0x0908);
}

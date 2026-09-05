// SPDX-License-Identifier: GPL-3.0-only

// loc_20ac  (ROM 0x20ac-0x20cc) — set up the VIDEORAM marker paint. loc_214e maps A=(0x400d) to a column
// pointer HL; DE=-0x20 is the row stride. When B bit 4 is set, pre-fill three cells with 0x10 and, if
// (0x400e)!=0, re-point HL via the alternate column ((0x400d)^1). Both paths tail into loc_20cd.
export function loc_20ac(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x400d);
  m.step(0x20af, 13); // ld a,(0x400d)

  // call 0x214e -- A -> VIDEORAM column pointer HL
  m.push16(0x20b2);
  m.step(0x214e, 17);
  m.call(0x214e);

  regs.de = 0xffe0;
  m.step(0x20b5, 10); // ld de,-0x20 -- row stride

  regs.bit(4, regs.b); // Z = B bit 4 clear
  m.step(0x20b7, 8);

  if (regs.fZ) {
    m.step(0x20cd, 12); // jr z,0x20cd (taken) -- straight to the paint
    return m.call(0x20cd);
  }
  m.step(0x20b9, 7); // jr z (not taken) -- bit 4 set: pre-fill

  regs.a = 0x10;
  m.step(0x20bb, 7); // ld a,0x10 -- pre-fill tile

  mem.write8(regs.hl, regs.a);
  m.step(0x20bc, 7); // (HL) = 0x10, VIDEORAM

  regs.addHl(regs.de);
  m.step(0x20bd, 11);

  mem.write8(regs.hl, regs.a);
  m.step(0x20be, 7);

  regs.addHl(regs.de);
  m.step(0x20bf, 11);

  mem.write8(regs.hl, regs.a);
  m.step(0x20c0, 7);

  regs.a = mem.read8(0x400e);
  m.step(0x20c3, 13); // ld a,(0x400e)

  regs.and(regs.a);
  m.step(0x20c4, 4); // and a

  if (regs.fZ) {
    m.ret(11); // ret z -- (0x400e)==0: done
    return;
  }
  m.step(0x20c5, 5); // ret z (not taken)

  regs.a = mem.read8(0x400d);
  m.step(0x20c8, 13); // ld a,(0x400d)

  regs.xor(0x01);
  m.step(0x20ca, 7); // xor 0x01 -- alternate column

  // call 0x214e -- re-point HL via the alternate column
  m.push16(0x20cd);
  m.step(0x214e, 17);
  m.call(0x214e);

  // fall through into loc_20cd -- separate head, delegate
  return m.call(0x20cd);
}

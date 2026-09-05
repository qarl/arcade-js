// SPDX-License-Identifier: GPL-3.0-only

// loc_04f2  (ROM 0x04f2-0x050e) — alternate arm of loc_0492, entered by its jr when (0x4011) bit0 is set.
// (0x4002)==0: set (0x4005)=1 and ret (the 0x0509 z-arm, interior, inlined). Else decrement (0x4002),
// zero-fill 0x41a0-0x41bf via rst 0x10, HL=0, and jp loc_04bc (back into loc_0492).
export function loc_04f2(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4002);
  m.step(0x04f5, 13);

  regs.and(regs.a);
  m.step(0x04f6, 4); // and a -- Z if (0x4002)==0

  if (regs.fZ) {
    m.step(0x0509, 12); // jr z,0x0509 (taken)

    regs.a = 0x01;
    m.step(0x050b, 7);

    mem.write8(0x4005, regs.a);
    m.step(0x050e, 13); // (0x4005) <- 1

    m.ret();
    return;
  }
  m.step(0x04f8, 7); // jr z (not taken)

  regs.a = regs.dec8(regs.a);
  m.step(0x04f9, 4); // dec a

  mem.write8(0x4002, regs.a);
  m.step(0x04fc, 13); // (0x4002) <- A-1

  regs.hl = 0x41a0;
  m.step(0x04ff, 10);

  regs.b = 0x20;
  m.step(0x0501, 7);

  regs.xor(regs.a);
  m.step(0x0502, 4); // xor a -- fill value 0

  m.push16(0x0503);
  m.step(0x0010, 11); // rst 0x10 -- block-fill 0x41a0-0x41bf <- 0
  m.call(0x0010);

  regs.hl = 0x0000;
  m.step(0x0506, 10);

  // jp 0x04bc -- back into loc_0492 (its 0x400d<-HL tail); loc_04bc is a genuine head, delegate
  m.step(0x04bc, 10);
  return m.call(0x04bc);
}

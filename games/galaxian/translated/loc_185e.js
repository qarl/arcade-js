// SPDX-License-Identifier: GPL-3.0-only

// loc_185e  (ROM 0x185e-0x186b) — high-byte processor for the 0x41c7 word. A=H; if H==0 return. Else store
// H-1 to 0x41c8 (the word's high byte) and pick A for loc_186c: A=0 when bit2 of (H-1) is clear, else 0x81.
// Falls through into loc_186c either way.
export function loc_185e(m) {
  const { regs, mem } = m;

  regs.a = regs.h;
  m.step(0x185f, 4); // ld a,h

  regs.and(regs.a);
  m.step(0x1860, 4); // and a -- test H

  if (regs.fZ) {
    m.ret(11); // ret z (taken) -- H==0
    return;
  }
  m.step(0x1861, 5); // ret z (not taken)

  regs.a = regs.dec8(regs.a);
  m.step(0x1862, 4); // dec a

  mem.write8(0x41c8, regs.a); // ld (0x41c8),a -- word high byte = H-1
  m.step(0x1865, 13);

  regs.and(0x04);
  m.step(0x1867, 7); // and 0x04 -- isolate bit2 of (H-1); A now 0 or 4

  if (regs.fZ) {
    // jp z,0x186c (taken) -- bit2 clear: enter loc_186c with A=0
    m.step(0x186c, 10);
    return m.call(0x186c);
  }
  m.step(0x186a, 10); // jp z,0x186c (not taken)

  regs.a = 0x81;
  m.step(0x186c, 7); // ld a,0x81 -- fall through into loc_186c

  return m.call(0x186c);
}

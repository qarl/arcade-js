// SPDX-License-Identifier: GPL-3.0-only

// loc_200a  (ROM 0x200a-0x2018) — dispatch loop: read the slot pointer 0x40a1, index page 0x40, read that
// slot's control byte; bit7 set -> call 0x2067 and re-scan; bit7 clear -> decode the slot at loc_2019.
export function loc_200a(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_200a:
    regs.h = 0x40;
    m.step(0x200c, 7); // ld h,0x40

    regs.a = mem.read8(0x40a1);
    m.step(0x200f, 13); // ld a,(0x40a1) -- current slot pointer (low byte, page 0x40)

    regs.l = regs.a;
    m.step(0x2010, 4); // ld l,a -- HL = 0x40:ptr

    regs.a = mem.read8(regs.hl);
    m.step(0x2011, 7); // ld a,(hl) -- slot control byte

    regs.add(regs.a);
    m.step(0x2012, 4); // add a,a -- bit7 -> carry

    if (regs.fNC) {
      m.step(0x2019, 12); // jr nc,0x2019 (taken) -- slot ready, go decode
      break;
    }
    m.step(0x2014, 7); // jr nc (not taken)

    m.push16(0x2017);
    m.step(0x2067, 17); // call 0x2067
    m.call(0x2067);

    m.step(0x200a, 12); // jr 0x200a -- re-scan the pointer
  }

  // fall-through into loc_2019 (slot decode) -- delegate
  return m.call(0x2019);
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_11b0  (ROM 0x11b0-0x11cf) — compute an object's direction octant toward a target and store it in
// (ix+0x05). D = 0xf0 - sprite Y (ix+0x03) (vertical delta); A = target X (0x4202) - sprite X (ix+0x04).
// When the X delta borrows (negative), mirror it (neg -> loc_11d0 -> neg) so the octant reflects direction.
export function loc_11b0(m) {
  const { regs, mem } = m;

  regs.a = 0xf0;
  m.step(0x11b2, 7);

  regs.sub(mem.read8(regs.ix + 0x03)); // A = 0xf0 - sprite Y
  m.step(0x11b5, 19);

  regs.d = regs.a; // D = vertical delta (divisor for loc_11d0)
  m.step(0x11b6, 4);

  regs.a = mem.read8(0x4202); // target X anchor
  m.step(0x11b9, 13);

  regs.sub(mem.read8(regs.ix + 0x04)); // A = target X - sprite X (horizontal delta)
  m.step(0x11bc, 19);

  if (regs.fC) {
    // jr c,0x11c5 (taken) -- negative horizontal delta: mirror
    m.step(0x11c5, 12);
    regs.neg(); // A = |X delta|
    m.step(0x11c7, 8);

    m.push16(0x11ca);
    m.step(0x11d0, 17);
    m.call(0x11d0); // A = octant of (|X delta| / D)

    regs.neg(); // mirror the octant back for the negative direction
    m.step(0x11cc, 8);

    mem.write8(regs.ix + 0x05, regs.a); // (ix+0x05) = direction octant
    m.step(0x11cf, 19);
    m.ret();
    return;
  }
  m.step(0x11be, 7); // jr c (not taken)

  m.push16(0x11c1);
  m.step(0x11d0, 17);
  m.call(0x11d0); // A = octant of (X delta / D)

  mem.write8(regs.ix + 0x05, regs.a);
  m.step(0x11c4, 19);

  m.ret();
}

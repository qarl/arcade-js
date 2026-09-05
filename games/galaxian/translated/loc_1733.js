// SPDX-License-Identifier: GPL-3.0-only

// loc_1733  (ROM 0x1733-0x1746) — tone toggler driven by duration 0x41ce. While nonzero it decrements the
// duration and writes the 0x4007 frame flag with bit0 flipped to sound_w reg5 (0x6805); when 0 it writes A(=0)
// instead. Both the jp-z path and the fall-through converge on the 0x1743 store.
export function loc_1733(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x41ce); // 0x41ce: remaining duration
  m.step(0x1736, 13);

  regs.and(regs.a); // Z when duration == 0
  m.step(0x1737, 4);

  if (regs.fNZ) {
    // jp z,0x1743 (not taken) -- still active
    m.step(0x173a, 10);

    regs.a = regs.dec8(regs.a);
    m.step(0x173b, 4);

    mem.write8(0x41ce, regs.a); // 0x41ce--
    m.step(0x173e, 13);

    regs.a = mem.read8(0x4007); // 0x4007: frame flag
    m.step(0x1741, 13);

    regs.xor(0x01); // toggle bit0
    m.step(0x1743, 7);
  } else {
    // jp z,0x1743 (taken) -- duration spent: store A(=0)
    m.step(0x1743, 10);
  }

  // loc_1743: shared store
  mem.write8(0x6805, regs.a, 10); // sound_w reg5; busOffset 10
  m.step(0x1746, 13);

  return m.ret();
}

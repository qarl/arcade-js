// SPDX-License-Identifier: GPL-3.0-only

// loc_1091  (ROM 0x1091-0x109a) — per-object step (IX = object struct in WRAM): bump sub-counter
// (ix+0x03), set the state byte (ix+0x02)=8, then tail-jump to loc_0f7b.
export function loc_1091(m) {
  const { regs, mem } = m;

  regs.incMem8(mem, regs.ix + 0x03);
  m.step(0x1094, 23); // inc (ix+0x03)

  mem.write8(regs.ix + 0x02, 0x08);
  m.step(0x1098, 19); // state (ix+0x02) <- 8

  m.step(0x0f7b, 10); // jp 0x0f7b
  return m.call(0x0f7b);
}

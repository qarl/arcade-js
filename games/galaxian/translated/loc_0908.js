// SPDX-License-Identifier: GPL-3.0-only

// loc_0908  (ROM 0x0908-0x090a) — commit the queue write-head: store A to 0x40a0, then fall through to
// loc_090b (pop hl + ret). Also the jr-nc target from loc_08f2.
export function loc_0908(m) {
  const { regs, mem } = m;

  mem.write8(0x40a0, regs.a);
  m.step(0x090b, 13); // ld (0x40a0),a -- updated queue write-head index

  return m.call(0x090b);
}

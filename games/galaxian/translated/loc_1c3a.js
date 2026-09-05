// SPDX-License-Identifier: GPL-3.0-only

// loc_1c3a  (ROM 0x1C3A-0x1C4F) — call 0x16f5 + 0x16a6, pet the watchdog, read IN0 (0x6000); if any of
// bits 7/1/0 (mask 0x83) are set, store 1 into (0x41c9). B keeps raw IN0. Falls through into loc_1c50.
export function loc_1c3a(m) {
  const { regs, mem } = m;

  // call 0x16f5
  m.push16(0x1c3d);
  m.step(0x16f5, 17);
  m.call(0x16f5);

  // call 0x16a6
  m.push16(0x1c40);
  m.step(0x16a6, 17);
  m.call(0x16a6);

  regs.a = mem.read8(0x7800);
  m.step(0x1c43, 13); // ld a,(0x7800) -- watchdog reset_r (value discarded)

  regs.a = mem.read8(0x6000);
  m.step(0x1c46, 13); // ld a,(0x6000) -- IN0

  regs.b = regs.a;
  m.step(0x1c47, 4); // ld b,a -- keep raw IN0

  regs.and(0x83);
  m.step(0x1c49, 7);

  if (regs.fZ) {
    m.step(0x1c50, 12); // jr z (taken) -- no IN0 bits set; skip the store
    return m.call(0x1c50);
  }
  m.step(0x1c4b, 7);

  regs.a = 0x01;
  m.step(0x1c4d, 7);

  mem.write8(0x41c9, regs.a);
  m.step(0x1c50, 13); // ld (0x41c9),a -- work RAM; fall through into loc_1c50

  return m.call(0x1c50);
}

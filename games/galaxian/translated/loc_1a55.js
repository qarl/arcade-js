// SPDX-License-Identifier: GPL-3.0-only

// loc_1a55  (ROM 0x1A55-0x1A59) — the entry of the cold-boot RAM/latch wipe, reached from the reset
// vector (loc_0000 -> jp 0x1a55). Points HL at VRAM (0x5000) and sets B=4 (four 0x100-byte pages,
// 0x5000-0x53FF), then falls through into the VRAM-clear page top at loc_1a5a (a separate routine).
//   1a55  21 00 50  ld hl,0x5000
//   1a58  06 04     ld b,0x04
//   -> fall through to loc_1a5a
export function loc_1a55(m) {
  const { regs } = m;

  regs.hl = 0x5000;
  m.step(0x1a58, 10); // ld hl,0x5000 -- VRAM base

  regs.b = 0x04;
  m.step(0x1a5a, 7); // ld b,0x04 -- four 0x100-byte pages (0x5000-0x53FF)

  // fall-through into loc_1a5a (the VRAM-clear page top) -- separate routine, delegate
  return m.call(0x1a5a);
}

// SPDX-License-Identifier: GPL-3.0-only

// loc_1b5d  (ROM 0x1B5D-0x1B61) — the clear-VRAM entry (call target from loc_1aff and loc_1b70): set the
// destination HL=0x5000 (VRAM base) and the page counter B=4, then fall into loc_1b62, which fills the four
// 256-byte VRAM pages (0x5000-0x53FF) with the blank tile.
//   1b5d  21 00 50  ld hl,0x5000
//   1b60  06 04     ld b,0x04
//   (fall into loc_1b62)
export function loc_1b5d(m) {
  const { regs, mem } = m;

  regs.hl = 0x5000;
  m.step(0x1b60, 10); // ld hl,0x5000 -- VRAM base

  regs.b = 0x04;
  m.step(0x1b62, 7); // ld b,0x04 -- 4 pages of 256 bytes; fall into loc_1b62

  return m.call(0x1b62);
}

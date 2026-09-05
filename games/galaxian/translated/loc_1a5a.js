// SPDX-License-Identifier: GPL-3.0-only

// loc_1a5a  (ROM 0x1A5A-0x1A5B) — top of each 256-byte VRAM-clear page pass inside the cold-boot
// RAM/latch wipe (reached from loc_1a55 the first time, and re-entered from loc_1a5c's `djnz 0x1a5a`
// for pages 2-4). Reloads the VRAM fill byte 0x10 (the blank/space tile) into A, then falls through
// into the page-fill loop at loc_1a5c.
//   1a5a  3e 10     ld a,0x10
export function loc_1a5a(m) {
  const { regs } = m;

  regs.a = 0x10;
  m.step(0x1a5c, 7); // ld a,0x10 -- VRAM fill byte (blank tile)

  // fall-through into loc_1a5c (the page-fill loop) -- delegate, do not inline
  return m.call(0x1a5c);
}

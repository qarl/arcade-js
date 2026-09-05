// SPDX-License-Identifier: GPL-3.0-only

// loc_1b04  (ROM 0x1b04-0x1b09) — the shared RAM-test result reporter. Both fail entries converge here
// (loc_1afb with A=1, loc_1aff with A=2); a passing path enters with A already set too. Store the result
// code A into VRAM cell 0x51f3 (on-screen), point DE at the 0x1b2d control table, and fall through into
// loc_1b0a which paints the diagnostic rows.
//   1b04  32 f3 51  ld (0x51f3),a    ; VRAM result cell (galaxian_videoram_w; not a hardware latch)
//   1b07  11 2d 1b  ld de,0x1b2d     ; -> control table for loc_1b0a
//   (falls through into loc_1b0a)
export function loc_1b04(m) {
  const { regs, mem } = m;

  mem.write8(0x51f3, regs.a); // ld (0x51f3),a -- VRAM (RAM-like: no bus-offset, not a hardware latch)
  m.step(0x1b07, 13);

  regs.de = 0x1b2d;
  m.step(0x1b0a, 10); // ld de,0x1b2d

  // fall-through into loc_1b0a (paints the diagnostic rows) -- delegate, do not inline
  return m.call(0x1b0a);
}

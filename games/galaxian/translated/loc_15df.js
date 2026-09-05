// SPDX-License-Identifier: GPL-3.0-only

// loc_15df  (ROM 0x15df-0x15e2) — copy-with-count helper for the loc_1544 loop (call z,0x15df fires when
// `dec (hl)` hit zero): store (DE) into (HL) and bump the C counter, then ret.
export function loc_15df(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(regs.de);
  m.step(0x15e0, 7); // ld a,(de)

  mem.write8(regs.hl, regs.a);
  m.step(0x15e1, 7); // ld (hl),a -- work RAM

  regs.c = regs.inc8(regs.c);
  m.step(0x15e2, 4); // inc c -- bump the copied-count

  m.ret();
}

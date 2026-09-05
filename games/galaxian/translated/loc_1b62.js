// SPDX-License-Identifier: GPL-3.0-only

// loc_1b62  (ROM 0x1B62-0x1B63) — the per-page entry: fall-through from loc_1b5d AND the djnz target from
// loc_1b64. Load the fill byte A=0x10 (the blank tile) for this page, then fall into the fill loop loc_1b64.
//   1b62  3e 10     ld a,0x10
//   (fall into loc_1b64)
export function loc_1b62(m) {
  const { regs, mem } = m;

  regs.a = 0x10;
  m.step(0x1b64, 7); // ld a,0x10 -- blank-tile fill byte; fall into loc_1b64

  return m.call(0x1b64);
}

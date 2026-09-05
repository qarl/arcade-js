// SPDX-License-Identifier: GPL-3.0-only

// loc_1aff  (ROM 0x1aff-0x1b03) — the VIDEORAM (0x5000) march-test fail entry. Reached from loc_1ae4's
// jr nz on a mismatch: call 0x1b5d (fail-side helper), load the fail code A=2, and fall through into the
// shared result reporter loc_1b04, which stores A into the on-screen result cell (0x51f3).
//   1aff  cd 5d 1b  call 0x1b5d      ; fail-side helper
//   1b02  3e 02     ld a,0x02        ; fail code 2 (VRAM test)
//   (falls through into loc_1b04)
export function loc_1aff(m) {
  const { regs } = m;

  m.push16(0x1b02);
  m.step(0x1b5d, 17); // call 0x1b5d
  m.call(0x1b5d);

  regs.a = 0x02;
  m.step(0x1b04, 7); // ld a,0x02

  // fall-through into loc_1b04 (the shared result reporter) -- delegate, do not inline
  return m.call(0x1b04);
}

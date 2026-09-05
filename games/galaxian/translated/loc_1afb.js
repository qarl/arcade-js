// SPDX-License-Identifier: GPL-3.0-only

// loc_1afb  (ROM 0x1afb-0x1afe) — the WORK-RAM (0x4000) march-test fail entry. Reached from loc_1ab1's
// jr nz on a mismatch: load the fail code A=1 and jr into the shared reporter loc_1b04, which stores A into
// the on-screen result cell (0x51f3).
//   1afb  3e 01     ld a,0x01        ; fail code 1 (work-RAM test)
//   1afd  18 05     jr 0x1b04        ; -> shared result reporter
export function loc_1afb(m) {
  const { regs } = m;

  regs.a = 0x01;
  m.step(0x1afd, 7); // ld a,0x01

  // jr 0x1b04 -- tail into the shared result reporter
  m.step(0x1b04, 12);
  return m.call(0x1b04);
}

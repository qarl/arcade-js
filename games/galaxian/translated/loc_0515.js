// SPDX-License-Identifier: GPL-3.0-only

// loc_0515  (ROM 0x0515-0x051a) — store 3 into (0x4195) and ret. Called (call c) from loc_0492 (loc_04bc
// arm) when the 0x401f rrca carry is set.
export function loc_0515(m) {
  const { regs, mem } = m;

  regs.a = 0x03;
  m.step(0x0517, 7);

  mem.write8(0x4195, regs.a);
  m.step(0x051a, 13); // (0x4195) <- 3

  m.ret();
}

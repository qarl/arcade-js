// SPDX-License-Identifier: GPL-3.0-only

// loc_050f  (ROM 0x050f-0x0514) — store 3 into (0x41b5) and ret. Called (call c) from loc_0492 when the
// 0x401f rrca carry is set.
export function loc_050f(m) {
  const { regs, mem } = m;

  regs.a = 0x03;
  m.step(0x0511, 7);

  mem.write8(0x41b5, regs.a);
  m.step(0x0514, 13); // (0x41b5) <- 3

  m.ret();
}

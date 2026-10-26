// SPDX-License-Identifier: GPL-3.0-only
// loc_0849  (ROM 0x0849-0x0853) -- frame-loop tail: two calls around `out 0x06`, then `jmp 0x081f`, taken by
// returning into loc_081f's loop (its sole caller) so the endless frame loop does not grow the JS stack.
export function loc_0849(m) {
  const { regs } = m;

  m.push16(0x084c); m.step(0x1775, 17); m.call(0x1775); // 0849  call 0x1775
  m.io.portOut(0x06, regs.a); m.step(0x084e, 10); // 084c  out 0x06
  m.push16(0x0851); m.step(0x1804, 17); m.call(0x1804); // 084e  call 0x1804
  m.step(0x081f, 10); // 0851  jmp 0x081f -- the sole caller, loc_081f, loops
}

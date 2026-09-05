// SPDX-License-Identifier: GPL-3.0-only

// loc_0595  (ROM 0x0595-0x0597) — set HL = 0x1d71 (copy source) and fall through to loc_0598, which copies
// 0x20 bytes from there into the 0x4021 stride-2 table. Called directly and reached by fall-through.
export function loc_0595(m) {
  const { regs } = m;

  regs.hl = 0x1d71;
  m.step(0x0598, 10); // HL = copy source

  return m.call(0x0598);
}

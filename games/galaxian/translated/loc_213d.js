// SPDX-License-Identifier: GPL-3.0-only

// loc_213d  (ROM 0x213d-0x2145) — test B: if non-negative (S clear) branch to loc_2146; else A=0xa4 and
// fall to loc_214a.
export function loc_213d(m) {
  const { regs } = m;

  regs.a = regs.b;
  m.step(0x213e, 4);

  regs.and(regs.a); // flags from B; S = bit7
  m.step(0x213f, 4);

  if (regs.fP) {
    m.step(0x2146, 10); // jp p,loc_2146 (taken; jp cc always 10T)
    return m.call(0x2146);
  }
  m.step(0x2142, 10); // jp p (not taken)

  regs.a = 0xa4;
  m.step(0x2144, 7);

  m.step(0x214a, 12); // jr loc_214a
  return m.call(0x214a);
}

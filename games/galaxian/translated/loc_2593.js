// SPDX-License-Identifier: GPL-3.0-only

// loc_2593  (ROM 0x2593-0x259d) — draw a 2x2 tile block UPWARD from (HL): save DE, set stride DE=0xffdf
// (-33), draw the top pair via loc_25a0, step the tile code back by 4, then tail-jump to loc_258c (draw the
// bottom pair + restore DE + ret, shared with loc_2585). Entered directly (A preset) or from loc_2591.
export function loc_2593(m) {
  const { regs } = m;

  m.push16(regs.de);
  m.step(0x2594, 11); // push de -- caller's DE, restored by loc_258c

  regs.de = 0xffdf;
  m.step(0x2597, 10); // ld de,0xffdf -- -33 stride (upward)

  m.push16(0x259a);
  m.step(0x25a0, 17); // call 0x25a0 -- top pair (A, A+1); A ends +2
  m.call(0x25a0);

  regs.add(0xfc);
  m.step(0x259c, 7); // add a,0xfc -- tile code -= 4

  // jr 0x258c -- tail-jump to loc_258c (bottom pair + pop de + ret); genuine head, NOT in our range
  m.step(0x258c, 12);
  return m.call(0x258c);
}

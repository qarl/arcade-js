// SPDX-License-Identifier: GPL-3.0-only

// loc_2585  (ROM 0x2585-0x2590) — draws a 2x2 tile block at (HL) from the seed in A: DE=0x1f stride, then
// two calls to loc_25a0, each writing a pair (A,A+1) and advancing HL by 0x20 (net). Preserves DE.
export function loc_2585(m) {
  const { regs } = m;

  m.push16(regs.de);
  m.step(0x2586, 11); // push de

  regs.de = 0x001f;
  m.step(0x2589, 10); // ld de,0x1f -- +1 (inc hl in 25a0) then +0x1f = +0x20 net per pair

  m.push16(0x258c);
  m.step(0x25a0, 17); // call 0x25a0 -- top pair (A, A+1)
  m.call(0x25a0);

  // loc_258c (interior; also a jr target from loc_2593, not our range)
  m.push16(0x258f);
  m.step(0x25a0, 17); // call 0x25a0 -- bottom pair (A+2, A+3)
  m.call(0x25a0);

  regs.de = m.pop16();
  m.step(0x2590, 10); // pop de

  m.ret();
}

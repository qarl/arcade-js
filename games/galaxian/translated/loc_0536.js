// SPDX-License-Identifier: GPL-3.0-only

// loc_0536  (ROM 0x0536-0x053f) — a game-state handler (dispatched from loc_0066's rst-28 as state 3).
// Runs loc_090d and loc_098e, then state-dispatches on (0x400a) via rst 0x28 through the inline word table
// at 0x0540-0x054f {0x0550,0x0583,0x05a5,0x0605,0x0614,0x0661,0x06d8,0x073d}. The dispatched target rets to
// loc_0536's caller (0x00d8), so the rst 0x28 is a tail-dispatch.
export function loc_0536(m) {
  const { regs, mem } = m;

  m.push16(0x0539);
  m.step(0x090d, 17); // call 0x090d
  m.call(0x090d);

  m.push16(0x053c);
  m.step(0x098e, 17); // call 0x098e
  m.call(0x098e);

  regs.a = mem.read8(0x400a);
  m.step(0x053f, 13); // A = sub-state index

  m.push16(0x0540); // rst 0x28 pushes the inline table base (0x0540) for loc_0028 to pop
  m.step(0x0028, 11);
  return m.call(0x0028);
}

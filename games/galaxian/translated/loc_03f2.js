// SPDX-License-Identifier: GPL-3.0-only

// loc_03f2  (ROM 0x03f2-0x03ff) — a top-level game-state handler: per-frame prep (0x090d, 0x098e), push
// 0x0492 as the post-dispatch continuation, then rst 0x28 dispatch on state (0x400a) via the inline word
// table 0x0400-0x0407 {0x0408,0x0430,0x0443,0x0473}. Reached via the loc_0066 dispatch (table @0x00d2).
export function loc_03f2(m) {
  const { regs, mem } = m;

  m.push16(0x03f5);
  m.step(0x090d, 17); // call 0x090d
  m.call(0x090d);

  m.push16(0x03f8);
  m.step(0x098e, 17); // call 0x098e
  m.call(0x098e);

  regs.hl = 0x0492;
  m.step(0x03fb, 10); // ld hl,0x0492 -- dispatched routine rets here

  m.push16(regs.hl);
  m.step(0x03fc, 11); // push hl

  regs.a = mem.read8(0x400a);
  m.step(0x03ff, 13); // A = game-state index

  // rst 0x28 -- state dispatch via inline table 0x0400-0x0407; loc_0028 pops this 0x0400 base and jp(hl)s to
  // table[A], which then rets to 0x0492.
  m.push16(0x0400);
  m.step(0x0028, 11);
  m.call(0x0028);

  return m.call(0x0492);
}

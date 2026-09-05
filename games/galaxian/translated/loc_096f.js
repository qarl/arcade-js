// SPDX-License-Identifier: GPL-3.0-only

// loc_096f  (ROM 0x096f-0x0971) — re-entry point (jp target of loc_0988): A = -L, then falls through into
// loc_0972 (which fills the 0x4028 table with A). Also reached by fall-through from loc_090d's 0x096c.
export function loc_096f(m) {
  const { regs, mem } = m;

  regs.a = regs.l;
  m.step(0x0970, 4); // ld a,l

  regs.neg();
  m.step(0x0972, 8); // neg -- A = -L

  // fall-through into loc_0972 (genuine head) -- delegate
  return m.call(0x0972);
}

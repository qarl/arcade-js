// SPDX-License-Identifier: GPL-3.0-only

// loc_004c  (ROM 0x004c-0x004f) — compare/subtract body of the 8-bit divide helper (A / D). Entered from
// loc_0048 (which set C=0, B=8) and re-entered each iteration by loc_0050's djnz. When A>=D it trial-
// subtracts D from A; the resulting borrow (carry) becomes this step's quotient bit in loc_0050. Falls
// through into loc_0050 (the shift/loop-tail).
export function loc_004c(m) {
  const { regs } = m;

  regs.cp(regs.d);
  m.step(0x004d, 4); // cp d -- borrow (carry) set iff A<D; A unchanged

  if (regs.fC) {
    m.step(0x0050, 12); // jr c,0x0050 (taken) -- A<D: no subtract this step
    return m.call(0x0050);
  }
  m.step(0x004f, 7); // jr c (not taken)

  regs.sub(regs.d);
  m.step(0x0050, 4); // sub d -- A>=D: A -= D

  // fall-through into loc_0050 (the shift/loop-tail) -- separate routine, delegate
  return m.call(0x0050);
}

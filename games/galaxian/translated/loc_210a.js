// SPDX-License-Identifier: GPL-3.0-only

// loc_210a  (ROM 0x210a-0x210d) — clamp tail: force B=0x80, then pop the AF the caller pushed and return.
// Reached from the callers at 0x2104/0x211d after their `push af`; the pop here balances that push.
export function loc_210a(m) {
  const { regs } = m;

  regs.b = 0x80;
  m.step(0x210c, 7);

  regs.af = m.pop16(); // restore the caller's pushed AF
  m.step(0x210d, 10);

  m.ret();
}

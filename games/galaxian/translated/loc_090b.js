// SPDX-License-Identifier: GPL-3.0-only

// loc_090b  (ROM 0x090b-0x090c) — restore HL and return. The common exit of the loc_08f2 enqueue path
// (reached on the slot-occupied jr-z, and by falling through loc_0908).
export function loc_090b(m) {
  const { regs } = m;

  regs.hl = m.pop16();
  m.step(0x090c, 10); // pop hl -- undo loc_08f2's push

  m.ret();
}

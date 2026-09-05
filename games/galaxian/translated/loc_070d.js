// SPDX-License-Identifier: GPL-3.0-only

// loc_070d  (ROM 0x070d) — bump (HL) then fall through to loc_070e. Reached by jr nc from loc_0722
// and by fall-through from loc_06d8's 0x0701 arm.
export function loc_070d(m) {
  const { regs, mem } = m;

  regs.incMem8(mem, regs.hl);
  m.step(0x070e, 11); // inc (hl)

  return m.call(0x070e);
}

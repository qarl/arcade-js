// SPDX-License-Identifier: GPL-3.0-only

// loc_0988  (ROM 0x0988-0x098d) — load HL from the 0x420e word cell, then tail-jump into loc_096f
// (the shared A=-L -> fill 0x4028-block routine); loc_096f's flow is ours to continue.
export function loc_0988(m) {
  const { regs, mem } = m;

  regs.hl = mem.read16(0x420e);
  m.step(0x098b, 16); // ld hl,(0x420e)

  // jp 0x096f -- unconditional tail-jump to a genuine head
  m.step(0x096f, 10);
  return m.call(0x096f);
}

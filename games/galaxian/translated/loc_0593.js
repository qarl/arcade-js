// SPDX-License-Identifier: GPL-3.0-only

// loc_0593  (ROM 0x0593-0x0594) — inc L then inc (HL) (on the loc_0583 fall-in, HL 0x4009 -> 0x400a so this
// bumps 0x400a), then fall through to loc_0595 which reseeds the copy. Also a jp target.
export function loc_0593(m) {
  const { regs, mem } = m;

  regs.l = regs.inc8(regs.l);
  m.step(0x0594, 4); // HL -> 0x400a on the fall-in path

  regs.incMem8(mem, regs.hl);
  m.step(0x0595, 11); // inc (HL)

  return m.call(0x0595);
}

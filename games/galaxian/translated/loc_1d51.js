// SPDX-License-Identifier: GPL-3.0-only

// loc_1d51  (ROM 0x1d51-0x1d57) — the 0x4009 branch. Entered from loc_1d28 (gate 0) or by falling out of
// loc_1d43, both with HL=0x4008. Bumps HL to 0x4009 and reads it: if already zero, tail-jumps to loc_1d58.
// Otherwise decrements 0x4009 and returns while non-zero, else falls into loc_1d58.
export function loc_1d51(m) {
  const { regs, mem } = m;

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1d52, 6); // 0x4008 -> 0x4009

  regs.a = mem.read8(regs.hl);
  m.step(0x1d53, 7); // A = 0x4009 byte

  regs.and(regs.a);
  m.step(0x1d54, 4);

  if (regs.fZ) {
    // jr z,0x1d58 (taken) -- 0x4009 already 0
    m.step(0x1d58, 12);
    return m.call(0x1d58);
  }
  m.step(0x1d56, 7); // jr z,0x1d58 (not taken)

  regs.decMem8(mem, regs.hl);
  m.step(0x1d57, 11); // dec (0x4009)

  if (regs.fNZ) {
    // ret nz (taken) -- still counting down
    m.ret(11);
    return;
  }
  m.step(0x1d58, 5); // ret nz (not taken)

  // fall-through into loc_1d58
  return m.call(0x1d58);
}

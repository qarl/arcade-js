// SPDX-License-Identifier: GPL-3.0-only

// loc_1c2c  (ROM 0x1C2C-0x1C2F) — point HL at OBJRAM and zero A, then fall through into loc_1c30 (the
// 0x5800-page clear loop that tail-jumps to 0x1b04). Reached from loc_1bed's mismatch branch.
//   [code]-level (instruction-faithful lift); MAME-grounding pending.
//   1c2c  21 00 58  ld hl,0x5800
//   1c2f  af        xor a
//   (falls through into loc_1c30)
export function loc_1c2c(m) {
  const { regs } = m;

  regs.hl = 0x5800;
  m.step(0x1c2f, 10); // ld hl,0x5800 -- OBJRAM base

  regs.xor(regs.a);
  m.step(0x1c30, 4); // xor a -- A=0; fall through into loc_1c30

  return m.call(0x1c30);
}

// SPDX-License-Identifier: GPL-3.0-only
/**
 * tail_1662 — hand-optimized rewrite of the translated routine at ROM 0x1662,
 * proven equal to its oracle by the equivalence harness. It touches the animation counter
 * 0x6388 and the sprite block 0x690B (unnamed in ram.js), so those stay hex.
 */

/**
 * tail_1662 -- bump the animation counter and step the sprite block.  [ROM 0x1662-0x1670]
 *
 * Two callers. It increments the counter at 0x6388, then rst 0x30 with A=1 -- a caller-skip
 * guard (the sub_0030 convention: if it aborts, return to this routine's caller). Otherwise
 * rst 0x38 subtracts 4 (C=0xFC) from each of the 10 bytes at 0x690B, then rets.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Two call paths, not all provably mask-cleared;
 * the rst guard's skip-boolean is honored and callees route through m.call.
 */
export function tail_1662(m) {
  const { regs, mem } = m;

  regs.hl = 0x6388;
  m.step(0x1665, 10);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // inc (0x6388)
  m.step(0x1666, 11);
  regs.a = 0x01;
  m.step(0x1668, 7);
  m.push16(0x1669);
  m.step(0x0030, 11);
  if (!m.call(0x0030)) return; // rst 0x30 caller-skip

  regs.hl = 0x690b;
  m.step(0x166c, 10);
  regs.c = 0xfc; // -4
  m.step(0x166e, 7);
  m.push16(0x166f);
  m.step(0x0038, 11);
  m.call(0x0038); // rst 0x38 -- subtract 4 from each of 10 bytes at 0x690B

  m.ret(10);
}

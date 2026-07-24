// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_30bd — hand-optimized rewrite of the translated routine at ROM 0x30BD,
 * proven equal to its oracle by the equivalence harness. A sprite-buffer processing pass;
 * it drives sub_30e4 over four regions and names no work RAM.
 */

/**
 * sub_30bd -- run the sub_30e4 pass over four sprite-buffer regions.  [ROM 0x30BD-0x30D9]
 *
 * Two callers. It calls sub_30e4 four times, each over a run of B records starting at HL:
 *   0x6950 (B=2), 0x6980 (B=0x0A), 0x69B8 (B=0x0B), 0x6A0C (B=5).
 * sub_30e4 preserves H, so the middle two reload L ONLY (HL stays in page 0x69); the last
 * reloads the full HL. The final call is a TAIL jump (no push) -- sub_30e4's ret returns to
 * sub_30bd's caller.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Two call paths, not all provably mask-cleared;
 * sub_30e4 routes through m.call (the registry).
 */
export function sub_30bd(m) {
  const { regs } = m;

  regs.hl = 0x6950;
  m.step(0x30c0, 10);
  regs.b = 0x02;
  m.step(0x30c2, 7);
  m.push16(0x30c5);
  m.step(0x30e4, 17);
  m.call(0x30e4); // preserves H

  regs.l = 0x80; // L only -- HL = 0x6980, H preserved at 0x69
  m.step(0x30c7, 7);
  regs.b = 0x0a;
  m.step(0x30c9, 7);
  m.push16(0x30cc);
  m.step(0x30e4, 17);
  m.call(0x30e4);

  regs.l = 0xb8; // HL = 0x69B8
  m.step(0x30ce, 7);
  regs.b = 0x0b;
  m.step(0x30d0, 7);
  m.push16(0x30d3);
  m.step(0x30e4, 17);
  m.call(0x30e4);

  regs.hl = 0x6a0c; // full HL reload for the last run
  m.step(0x30d6, 10);
  regs.b = 0x05;
  m.step(0x30d8, 7);

  // TAIL JUMP: no push. sub_30e4's ret returns to sub_30bd's caller.
  m.step(0x30e4, 10);
  return m.call(0x30e4);
}

// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_1186 — hand-optimized rewrite of the translated routine at ROM 0x1186,
 * proven equal to its oracle by the equivalence harness. A small fill+gather coordinator;
 * it names no work RAM.
 */

/**
 * sub_1186 -- fill the 0x6500 object block and gather it into its sprite mirror. [ROM 0x1186-0x11A1]
 *
 * Called from the board-2 and board-3 setups (0x101F, 0x1087). Two steps over the shared
 * helpers:
 *   - sub_122a: strided fill of the 4-byte inline data at 0x11A2 into 0x6507 (BC = 0x0A0C,
 *     so B = 0x0A passes, C = 0x0C stride),
 *   - sub_11d3: permuting gather from IX = 0x6500 into 0x6980 (B = 0x0A, DE = 0x0010 stride;
 *     C still holds sub_122a's restored 0x0C).
 * Then ret. 0x11A2 is a 4-byte DATA block, not code.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Reached from the board setups, whose atomicity
 * is not pinned to the mask-cleared NMI; callees route through m.call (the registry).
 */
export function sub_1186(m) {
  const { regs } = m;

  regs.hl = 0x11a2; // -> 4-byte data block, not code
  m.step(0x1189, 10);
  regs.de = 0x6507;
  m.step(0x118c, 10);
  regs.bc = 0x0a0c; // B = 0x0A passes, C = 0x0C stride
  m.step(0x118f, 10);
  m.push16(0x1192);
  m.step(0x122a, 17);
  m.call(0x122a);

  regs.ix = 0x6500;
  m.step(0x1196, 14);
  regs.hl = 0x6980;
  m.step(0x1199, 10);
  regs.b = 0x0a; // C left by sub_122a
  m.step(0x119b, 7);
  regs.de = 0x0010; // stride
  m.step(0x119e, 10);
  m.push16(0x11a1);
  m.step(0x11d3, 17);
  m.call(0x11d3);

  m.ret(); // 0x11A1
}

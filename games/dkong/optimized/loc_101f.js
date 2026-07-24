// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_101f — hand-optimized rewrite of the translated routine at ROM 0x101F,
 * proven equal to its oracle by the equivalence harness. A board-setup coordinator over
 * the shared fill helpers; only its single 0x62B9 store is a work-RAM write of its own.
 */

/**
 * loc_101f -- board-2 (50m / conveyors) sprite-and-object setup.  [ROM 0x101F-0x1086]
 *
 * rst-0x28 table entry 2: the per-board setup sub_0f56 dispatches to for BOARD == 2. A
 * fixed chain over the shared helpers, four ldir blocks, and a final flag:
 *   - sub_122a (ROM 0x3DEC -> 0x6407, B=5, C=0x1C), sub_1186 (fill 0x6507 / gather 0x6980),
 *   - sub_122a (ROM 0x3E18 -> 0x65A7, B=6, C=0x0C),
 *   - sub_11d3 gather from IX=0x65A0 into 0x69B8 (B=6, DE=0x10),
 *   - sub_11fa scatter with HL=0x3DFA live-in,
 *   - ldir 4 bytes 0x3E04 -> 0x69FC, ldir 8 bytes 0x3E1C -> 0x6944, ldir 0x18 bytes
 *     0x3E24 -> 0x69E4,
 *   - sub_11a6 with HL=0x3E10 live-in,
 *   - ldir 0x0C bytes 0x3E3C -> 0x6A0C,
 *   - 0x62B9 = 1 (a board-2 flag), ret.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Reached via the board-setup dispatch, whose
 * atomicity is not pinned to the mask-cleared NMI; callees route through m.call.
 */
export function loc_101f(m) {
  const { regs, mem } = m;

  regs.hl = 0x3dec;
  m.step(0x1022, 10);
  regs.de = 0x6407;
  m.step(0x1025, 10);
  regs.bc = 0x051c;
  m.step(0x1028, 10);
  m.push16(0x102b);
  m.step(0x122a, 17);
  m.call(0x122a);

  m.push16(0x102e);
  m.step(0x1186, 17);
  m.call(0x1186);

  regs.hl = 0x3e18;
  m.step(0x1031, 10);
  regs.de = 0x65a7;
  m.step(0x1034, 10);
  regs.bc = 0x060c;
  m.step(0x1037, 10);
  m.push16(0x103a);
  m.step(0x122a, 17);
  m.call(0x122a);

  regs.ix = 0x65a0;
  m.step(0x103e, 14);
  regs.hl = 0x69b8;
  m.step(0x1041, 10);
  regs.de = 0x0010; // stride
  m.step(0x1044, 10);
  regs.b = 0x06;
  m.step(0x1046, 7);
  m.push16(0x1049);
  m.step(0x11d3, 17);
  m.call(0x11d3);

  regs.hl = 0x3dfa; // live-in to sub_11fa
  m.step(0x104c, 10);
  m.push16(0x104f);
  m.step(0x11fa, 17);
  m.call(0x11fa);

  regs.hl = 0x3e04;
  m.step(0x1052, 10);
  regs.de = 0x69fc;
  m.step(0x1055, 10);
  regs.bc = 0x0004;
  m.step(0x1058, 10);
  m.ldir(0x105a);

  regs.hl = 0x3e1c;
  m.step(0x105d, 10);
  regs.de = 0x6944;
  m.step(0x1060, 10);
  regs.bc = 0x0008;
  m.step(0x1063, 10);
  m.ldir(0x1065);

  regs.hl = 0x3e24;
  m.step(0x1068, 10);
  regs.de = 0x69e4;
  m.step(0x106b, 10);
  regs.bc = 0x0018;
  m.step(0x106e, 10);
  m.ldir(0x1070);

  regs.hl = 0x3e10; // live-in to sub_11a6
  m.step(0x1073, 10);
  m.push16(0x1076);
  m.step(0x11a6, 17);
  m.call(0x11a6);

  regs.hl = 0x3e3c;
  m.step(0x1079, 10);
  regs.de = 0x6a0c;
  m.step(0x107c, 10);
  regs.bc = 0x000c;
  m.step(0x107f, 10);
  m.ldir(0x1081);

  regs.a = 0x01;
  m.step(0x1083, 7);
  mem.write8(0x62b9, regs.a); // 0x62B9 = 1 (board-2 flag)
  m.step(0x1086, 13);

  m.ret(); // 0x1086
}

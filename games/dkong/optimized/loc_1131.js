// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1131 — hand-optimized rewrite of the translated routine at ROM 0x1131,
 * proven equal to its oracle by the equivalence harness. A board-setup coordinator over
 * the shared fill helpers; it names no work RAM.
 */

/**
 * loc_1131 -- board-4 (100m / rivets) sprite-and-object setup.  [ROM 0x1131-0x117D]
 *
 * rst-0x28 table entry 4: the per-board setup sub_0f56 dispatches to for BOARD == 4. A
 * fixed chain over the shared helpers:
 *   - sub_122a: strided fill of ROM 0x3DF0 into 0x6407 (B=5, C=0x1C),
 *   - sub_11a6 with HL=0x3E14 live-in (object slots 0x6680/0x6690),
 *   - ldir 0x0C bytes ROM 0x3E54 -> 0x6A0C,
 *   - sub_11ec: interleaved copy of ROM 0x1182 (the 2nd inline data unit, used first) into
 *     0x64A3 (B=2, C=0x1E),
 *   - sub_122a: strided fill of ROM 0x117E (the 1st unit, used second) into 0x64A7 (B=2, C=0x1C),
 *   - IX=0x64A0; mark IX+0 and IX+0x20 live (=0x01, stride 0x20),
 *   - sub_11d3: permuting gather into 0x6950 (B=2, DE=0x20 stride),
 *   - ret.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Reached via the board-setup dispatch, whose
 * atomicity is not pinned to the mask-cleared NMI; callees route through m.call.
 */
export function loc_1131(m) {
  const { regs, mem } = m;

  regs.hl = 0x3df0;
  m.step(0x1134, 10);
  regs.de = 0x6407;
  m.step(0x1137, 10);
  regs.bc = 0x051c;
  m.step(0x113a, 10);
  m.push16(0x113d);
  m.step(0x122a, 17);
  m.call(0x122a);

  regs.hl = 0x3e14; // live-in to sub_11a6
  m.step(0x1140, 10);
  m.push16(0x1143);
  m.step(0x11a6, 17);
  m.call(0x11a6);

  regs.hl = 0x3e54;
  m.step(0x1146, 10);
  regs.de = 0x6a0c;
  m.step(0x1149, 10);
  regs.bc = 0x000c;
  m.step(0x114c, 10);
  m.ldir(0x114e); // ldir 0x0C bytes -> 0x6A0C

  regs.hl = 0x1182; // 2nd data unit, used first
  m.step(0x1151, 10);
  regs.de = 0x64a3;
  m.step(0x1154, 10);
  regs.bc = 0x021e;
  m.step(0x1157, 10);
  m.push16(0x115a);
  m.step(0x11ec, 17);
  m.call(0x11ec);

  regs.hl = 0x117e; // 1st data unit, used second
  m.step(0x115d, 10);
  regs.de = 0x64a7;
  m.step(0x1160, 10);
  regs.bc = 0x021c;
  m.step(0x1163, 10);
  m.push16(0x1166);
  m.step(0x122a, 17);
  m.call(0x122a);

  regs.ix = 0x64a0;
  m.step(0x116a, 14);
  mem.write8((regs.ix + 0x00) & 0xffff, 0x01);
  m.step(0x116e, 19);
  mem.write8((regs.ix + 0x20) & 0xffff, 0x01); // stride 0x20
  m.step(0x1172, 19);

  regs.hl = 0x6950;
  m.step(0x1175, 10);
  regs.b = 0x02;
  m.step(0x1177, 7);
  regs.de = 0x0020; // stride
  m.step(0x117a, 10);
  m.push16(0x117d);
  m.step(0x11d3, 17);
  m.call(0x11d3);

  m.ret(); // 0x117D
}

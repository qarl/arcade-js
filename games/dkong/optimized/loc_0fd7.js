// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0fd7 — hand-optimized rewrite of the translated routine at ROM 0x0FD7,
 * proven equal to its oracle by the equivalence harness. The destinations are inside the
 * sprite buffer (0x6900-0x6A7F) and its shadow rows; they lack settled ram.js names, so
 * they stay hex with the oracle's descriptive comments.
 */

/**
 * loc_0fd7 -- fill the board-1 (25m) sprite buffer.  [ROM 0x0FD7-0x101A]
 *
 * rst-0x28 table entry 1: the per-board setup sub_0f56 dispatches to for BOARD == 1.
 * THIS IS WHERE THE 25m SPRITES COME FROM -- the destinations 0x69A8/0x69FC are inside
 * 0x6900-0x6A7F, the sprite buffer the i8257 blits to 0x7000 every vblank (sub_0874 clears
 * this range at boot; this fills it). It runs a fixed sequence:
 *   - ldir 0x10 bytes of ROM 0x3DDC into 0x69A8,
 *   - sub_122a: strided fill of ROM 0x3DEC into 0x6407 (C=0x1C stride, B=5 passes),
 *   - sub_11fa with HL=0x3DF4 as a LIVE-IN parameter,
 *   - ldir 4 bytes of ROM 0x3E00 into 0x69FC,
 *   - sub_11a6 with HL=0x3E0C as a LIVE-IN parameter (passed through to sub_11ec),
 *   - sub_122a: strided fill from 0x101B (the 4 DATA bytes 00 00 02 02 after this
 *     routine's `ret`) into 0x6707 (B=8, C=0x1C), then again into 0x6807 (B=2),
 *   - ret.
 *
 * sub_122a preserves DE and B across the reload at 0x1015 (it reloads DE and B only, not
 * HL/C -- the site that proves the preservation). 0x101B being read as source data is why
 * the coverage map shows 0x101B-0x101E unreached: it is data, not code.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Reached via the board-setup dispatch, whose
 * atomicity is not pinned to the mask-cleared NMI; every call keeps its push16/step
 * scaffolding and callees route through m.call (the registry).
 */
export function loc_0fd7(m) {
  const { regs } = m;

  regs.hl = 0x3ddc;
  m.step(0x0fda, 10);
  regs.de = 0x69a8; // inside the sprite buffer
  m.step(0x0fdd, 10);
  regs.bc = 0x0010;
  m.step(0x0fe0, 10);
  m.ldirAt(0x0fe0, 0x0fe2);

  regs.hl = 0x3dec;
  m.step(0x0fe5, 10);
  regs.de = 0x6407;
  m.step(0x0fe8, 10);
  regs.c = 0x1c;
  m.step(0x0fea, 7);
  regs.b = 0x05;
  m.step(0x0fec, 7);
  m.push16(0x0fef);
  m.step(0x122a, 17);
  m.call(0x122a);

  // HL is a LIVE-IN parameter to sub_11fa (sub_122a left C=0x1C, HL=0x3DEC, both dead here).
  regs.hl = 0x3df4;
  m.step(0x0ff2, 10);
  m.push16(0x0ff5);
  m.step(0x11fa, 17);
  m.call(0x11fa);

  regs.hl = 0x3e00;
  m.step(0x0ff8, 10);
  regs.de = 0x69fc; // inside the sprite buffer, like 0x69A8
  m.step(0x0ffb, 10);
  regs.bc = 0x0004;
  m.step(0x0ffe, 10);
  m.ldirAt(0x0ffe, 0x1000);

  // HL is a LIVE-IN parameter of sub_11a6, passed straight through to sub_11ec.
  regs.hl = 0x3e0c;
  m.step(0x1003, 10);
  m.push16(0x1006);
  m.step(0x11a6, 17);
  m.call(0x11a6);

  regs.hl = 0x101b; // the 4 DATA bytes (00 00 02 02) after this routine's ret
  m.step(0x1009, 10);
  regs.de = 0x6707;
  m.step(0x100c, 10);
  regs.bc = 0x081c; // B = 8 passes, C = 0x1C stride
  m.step(0x100f, 10);
  m.push16(0x1012);
  m.step(0x122a, 17);
  m.call(0x122a);

  // reloads DE and B ONLY (not HL/C) -- proves sub_122a preserves both.
  regs.de = 0x6807;
  m.step(0x1015, 10);
  regs.b = 0x02;
  m.step(0x1017, 7);
  m.push16(0x101a);
  m.step(0x122a, 17);
  m.call(0x122a);

  m.ret(); // 0x101A
}

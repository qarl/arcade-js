// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0d43 — hand-optimized rewrite of the translated routine at ROM 0x0D43,
 * proven equal to its oracle by the equivalence harness. Stores land in video RAM
 * (0x74xx-0x77xx), so there is no ram.js name to import.
 */

/**
 * sub_0d43 -- clear two sprite rows of the 100m board.  [ROM 0x0D43-0x0D4B]
 *
 *   0d43  21 87 76     ld   hl,0x7687   ; HL -> upper sprite row
 *   0d46  cd 4c 0d     call 0x0d4c      ; sub_0d4c: fill 4 cells 0xFD, skip 0x1C, 4 cells 0xFC
 *   0d49  21 47 75     ld   hl,0x7547   ; HL -> lower sprite row
 *   0d4c  ...          (falls straight into sub_0d4c -- tail call)
 *
 * The twin of sub_0d27: point HL at each row base and run the shared filler sub_0d4c
 * twice. Called once during 100m (board 4) setup, from loc_0c92's board-4 arm
 * ("sprite-row clear", ROM 0x0D3F). Same tail-call idiom: the FIRST sub_0d4c is a real
 * `call` (return 0x0D49 pushed), the SECOND is a fall-through whose `ret` returns to
 * sub_0d43's caller.
 *
 * ATOMIC — cycles COLLAPSED, total preserved. Its only caller loc_0c92 runs inside the
 * mask-cleared vblank NMI (dispatchGameState), and callee sub_0d4c is a pure VRAM-fill
 * leaf, so the NMI never lands inside sub_0d43 — its distribution is unobservable. The
 * three own charges (ld 10 + call 17 + ld 10) collapse to two: the leading ld folds
 * into the first call (27t), the trailing ld keeps its 10t; 27 + 10 = 37t, the oracle's
 * exact own total. The two sub_0d4c calls (267t each) run via m.call to the oracle,
 * unchanged. VRAM only, no 0x7Dxx latch, so the collapse needs no write-trace.
 */
export function sub_0d43(m) {
  const { regs } = m;

  // ld hl,0x7687 ; call 0x0d4c -- fill the upper row (ld+call folded: 10+17 = 27t).
  regs.hl = 0x7687;
  m.push16(0x0d49);
  m.step(0x0d4c, 27);
  m.call(0x0d4c);

  // ld hl,0x7547 -- then FALL THROUGH into sub_0d4c (tail): no push, its ret returns
  // to sub_0d43's caller. 10t, and it positions PC at 0x0D4C.
  regs.hl = 0x7547;
  m.step(0x0d4c, 10);
  return m.call(0x0d4c);
}

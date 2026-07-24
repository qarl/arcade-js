// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0e19 — hand-optimized rewrite of the translated routine at ROM 0x0E19,
 * proven equal to its oracle by the equivalence harness. Stores land in video RAM
 * and board-render scratch (0x63B2, currently unnamed), so no ram.js name is imported.
 */

/**
 * loc_0e19 -- draw a vertical run of girder/ladder cells.  [ROM 0x0E19-0x0E29]
 *
 * A draw primitive of the board-layout renderer (sub_0da7 walks the ROM layout table
 * and dispatches here for a "vertical run" op). It repeatedly steps the span counter
 * at 0x63B2 down by 8 and, while it has not underflowed, stamps tile 0xC0 into the
 * next cell down the tilemap column (HL advanced by `inc l`, which wraps within the
 * 32-cell page). When the subtraction borrows (carry), the span is exhausted and it
 * tail-jumps into loc_0e2a (its `ret` returns to loc_0e19's caller).
 *
 *   loop: a = (0x63B2); a -= 8; (0x63B2) = a
 *         if carry -> jp loc_0e2a         ; span done
 *         inc l ; (hl) = 0xC0 ; jp loop   ; draw one cell, continue
 *
 * INPUTS : 0x63B2 (span counter, in units of 8), HL (current tilemap cell).
 * OUTPUTS: 0x63B2 decremented past 0; video RAM cells = 0xC0; HL advanced. F = the
 *          final `sub 0x08` (the `inc l` sets none observable at the tail).
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. loc_0e19 is a draw primitive of sub_0da7,
 * which is reached from many callers (board-setup handlers, but also the intro/how-high
 * steppers loc_17b6/loc_1880 whose dispatch context is not pinned to the mask-cleared
 * NMI). Since atomicity is not provable on every call path, the per-instruction charges
 * are kept verbatim (always correct); the vblank NMI, if it can land inside, then pushes
 * the oracle's exact PC. The routine is already a tight loop; the win is the documented
 * behaviour, not a collapse.
 */
export function loc_0e19(m) {
  const { regs, mem } = m;

  for (;;) {
    // a = (0x63B2) - 8; store back. Carry = span exhausted.
    regs.a = mem.read8(0x63b2);
    m.step(0x0e1c, 13);
    regs.sub(0x08);
    m.step(0x0e1e, 7);
    mem.write8(0x63b2, regs.a);
    m.step(0x0e21, 13);
    if (regs.fC) {
      m.step(0x0e2a, 10); // jp c taken -- fall into loc_0e2a
      break;
    }
    m.step(0x0e24, 10); // jp c not taken

    // draw one 0xC0 cell down the column, then loop.
    regs.l = regs.inc8(regs.l);
    m.step(0x0e25, 4);
    mem.write8(regs.hl, 0xc0);
    m.step(0x0e27, 10);
    m.step(0x0e19, 10); // jp 0x0e19
  }

  // tail jump: no push16 -- loc_0e2a's ret returns to loc_0e19's caller.
  return m.call(0x0e2a);
}

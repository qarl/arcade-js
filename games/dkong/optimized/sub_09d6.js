// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_09d6 — hand-optimized rewrite of the translated routine at ROM 0x09D6,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x309f, 0x09ee) is reached through
 * `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so it resolves
 * to the oracle — or to that callee's own optimized rewrite once one exists —
 * never a copied implementation. Only the RAM name GAME_SUBSTATE is imported (ram.js).
 */

import { GAME_SUBSTATE } from "./ram.js";

// Two board control latches this routine clears to 0. They live in the board's
// 0x7D00-page control space (0x7D86, 0x7D87), NOT work RAM, so they are not in
// ram.js and stay hex. sub_0a1b (ROM 0x0A1B) clears the identical pair with the
// same `xor a / ld (nn),a / ld (nn),a` opener.
const PALETTE_LATCH_A = 0x7d86;
const PALETTE_LATCH_B = 0x7d87;

/**
 * sub_09d6 -- 2-PLAYER board-setup arm: clear two control latches, enqueue two
 * draw tasks, arm sub-state 5, then draw the shared 3-cell column (sub_09ee).
 * [ROM 0x09D6-0x09ED, then FALLS THROUGH into sub_09ee @ 0x09EE.]
 *
 *   09d6  af          xor  a            ; A = 0
 *   09d7  32 86 7d    ld   (0x7d86),a   ; latch A = 0
 *   09da  32 87 7d    ld   (0x7d87),a   ; latch B = 0
 *   09dd  11 02 03    ld   de,0x0302    ; task [opcode 3, arg 2]
 *   09e0  cd 9f 30    call 0x309f       ; enqueue it
 *   09e3  11 01 02    ld   de,0x0201    ; task [opcode 2, arg 1]
 *   09e6  cd 9f 30    call 0x309f       ; enqueue it
 *   09e9  3e 05       ld   a,0x05       ; next sub-state = 5
 *   09eb  32 0a 60    ld   (0x600a),a   ; GAME_SUBSTATE = 5
 *   09ee  ...  falls through into sub_09ee (paint the 3-cell column)
 *
 * WHAT IT DOES / WHERE IT SITS. This is table entry 2 of the in-game GAME_STATE==3
 * sub-state dispatcher (loc_06fe's 0x0702 table; reached when GAME_SUBSTATE==2).
 * loc_09ab (entry 1) routes HERE instead of straight to sub-state 5 only when the
 * two-player marker 0x600F is non-zero -- i.e. this is the 2-PLAYER variant of the
 * board-setup step (loc_08f8's 2-player start writes 0x600F = 1). It zeroes two
 * board control latches (0x7D86/0x7D87), enqueues two draw tasks via sub_309f
 * (0x0302 then 0x0201 -- opcode:arg pairs on the 0x60C0 task ring), advances
 * GAME_SUBSTATE to 5, then FALLS THROUGH into sub_09ee, which paints one tilemap
 * column (three cells 0x20 apart: 0x74E0, 0x74C0, 0x74A0). sub_09ee's own `ret`
 * is what returns from this routine -- a tail fall-through, no push of its own,
 * which is why there is NO m.push16 before the final m.call.
 *
 * INPUTS: none read from RAM (A is loaded, not read). Callee sub_309f reads +
 *   updates the task-ring tail (0x60B0) and ring (0x60C0). OUTPUTS: 0x7D86 = 0,
 *   0x7D87 = 0, two enqueued tasks, GAME_SUBSTATE(0x600A) = 5, and VRAM
 *   0x74E0/0x74C0/0x74A0 (via sub_09ee). Registers on return: A = 0x20 (sub_09ee's
 *   last load), DE = 0x0201; HL and BC are preserved (sub_309f push/pops HL,
 *   neither callee touches BC).
 *
 * FLAGS. Nothing after this routine consumes its flags -- the caller is the NMI's
 *   rst-0x28 game-state dispatch, a tail `jp (hl)` that branches on no flag set
 *   here. The unit gate still compares F, so the register churn is faithful: the
 *   final flag-writer on the path is the SECOND sub_309f call (run verbatim via
 *   m.call); sub_09ee touches no flag, so F on return equals the oracle's. The
 *   leading `xor a` is kept verbatim -- it both zeroes A for the two latch stores
 *   AND sets the flags the oracle sets there (sub_309f then overwrites them).
 *
 * ATOMIC — cycles collapsed to one charge per straight-line segment. sub_09d6 runs
 *   INSIDE the vblank NMI (dispatchGameState), and the NMI does not re-enter, so no
 *   NMI ever lands inside it or its short callees (sub_309f enqueue, sub_09ee's 3
 *   VRAM writes): a boot+2coin+start2 probe dispatched it once (frame 44) with the
 *   NMI landing inside it ZERO times. So its internal cycle DISTRIBUTION is
 *   unobservable and the per-instruction m.step charges collapse to ONE per
 *   straight-line segment, each folding the following CALL's 17t:
 *     segment A = xor(4)+ld(13)+ld(13)+ld de(10)+call(17) = 57  (before enqueue 1)
 *     segment B = ld de(10)+call(17)                       = 27  (before enqueue 2)
 *     segment C = ld a(7)+ld (0x600a),a(13)                = 20  (before fall-through)
 *   total 104 -- exactly the oracle's own-instruction sum. sub_309f/sub_09ee keep
 *   charging themselves. The TOTAL stays load-bearing: as part of the NMI's cost it
 *   sets the main-loop spin count (README §2, SPIN_COUNT), so it is preserved
 *   exactly and whole-machine EQUAL confirms it (a wrong total would diverge at
 *   0x6019). Same finding + mechanism as loc_08f8.
 *
 * SINGLE PATH. This routine is straight-line -- it has NO data-dependent branch of
 *   its own (the only conditionals live inside the callees), so there is exactly
 *   one branch and the natural 2-player run exercises it end to end.
 */
export function sub_09d6(m) {
  const { regs, mem } = m;

  // -- segment A: xor a; clear both latches; DE = task 0x0302; enqueue --
  regs.xor(regs.a); // A = 0 (also sets the flags the oracle sets; sub_309f overwrites)
  mem.write8(PALETTE_LATCH_A, regs.a);
  mem.write8(PALETTE_LATCH_B, regs.a);
  regs.de = 0x0302; // task [opcode 3, arg 2]
  m.push16(0x09e3);
  m.step(0x309f, 57); // xor(4)+ld(13)+ld(13)+ld de(10)+call(17)
  m.call(0x309f);

  // -- segment B: DE = task 0x0201; enqueue --
  regs.de = 0x0201; // task [opcode 2, arg 1]
  m.push16(0x09e9);
  m.step(0x309f, 27); // ld de(10)+call(17)
  m.call(0x309f);

  // -- segment C: GAME_SUBSTATE = 5; fall through into sub_09ee --
  regs.a = 0x05;
  mem.write8(GAME_SUBSTATE, regs.a); // 0x600A = 5
  m.step(0x09ee, 20); // ld a(7)+ld (0x600a),a(13); PC falls into sub_09ee
  return m.call(0x09ee); // sub_09ee paints the column; its ret returns from here
}

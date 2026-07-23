// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_055f — hand-optimized rewrite of the translated routine at ROM 0x055F,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. sub_055f is a LEAF (it calls nothing), so there is no
 * `m.call` here — only RAM *names* are imported (from ram.js). It is reached
 * ONLY by `m.call(0x055f)` from entry_051c (ROM 0x051C, task-table entry 0), at
 * that routine's 0x051E and 0x0550 call sites.
 */

import { CURRENT_PLAYER, P1_SCORE, P2_SCORE } from "./ram.js";

/**
 * sub_055f -- select the CURRENT player's 3-byte BCD score base into DE.
 * [ROM 0x055F-0x056A, 12 bytes, 6 instructions -- a leaf, two ordinary `ret` exits]
 *
 *   055f  11 b2 60   ld   de,0x60b2   ; DE = P1_SCORE (the default)
 *   0562  3a 0d 60   ld   a,(0x600d)  ; A  = CURRENT_PLAYER
 *   0565  a7         and  a           ; set Z from A (also clears C, sets H)
 *   0566  c8         ret  z           ; player 0 -> keep P1_SCORE, return
 *   0567  11 b5 60   ld   de,0x60b5   ; DE = P2_SCORE (overwrites the 0x055F load)
 *   056a  c9         ret
 *
 * WHAT IT DOES. Picks which player's score the caller will read/write: DE is
 * loaded with P1_SCORE unconditionally, then OVERWRITTEN with P2_SCORE unless
 * CURRENT_PLAYER (0x600D) is zero. The fall-through IS the selection -- the same
 * "load the default, `ret z`, else load the alternate" shape handler_05c6 uses at
 * 0x05CB/0x05D2. entry_051c calls it twice (0x051E, 0x0550) so its BCD score-add
 * and its high-score copy operate on the live player's score triple.
 *
 * INPUTS.  RAM read: CURRENT_PLAYER (0x600D). No register is read as an input --
 * the incoming DE and A are both overwritten before use.
 * OUTPUTS.  DE = P1_SCORE (0x60B2) when CURRENT_PLAYER == 0, else P2_SCORE
 * (0x60B5). It writes NO memory: its entire contract is the DE register.
 * CLOBBERS.  A = CURRENT_PLAYER at both exits; F = the `and a` result (Z from A,
 * C cleared, H set, S/PV from A). entry_051c consumes neither (the 0x051E call is
 * followed by `ld a,c`, the 0x0550 call by `ld hl,0x60b8`) -- but the unit gate
 * compares the WHOLE register file incl. A and F, so both are reproduced verbatim:
 * A is left = mem(CURRENT_PLAYER) and F = the `and a` flags via regs.and(regs.a).
 *
 * FLAGS.  regs.and(regs.a) is kept for its Z (it decides the branch AND is the
 * observed F at both exits). No other op here touches flags.
 *
 * ATOMICITY / CYCLES -- PER-INSTRUCTION (deliberately NOT collapsed).  sub_055f
 * itself makes no call and cannot span a frame, but ATOMICITY IS PER-CALL-PATH:
 * its ONLY caller, entry_051c, is a MAIN-LOOP routine (dispatched by dispatchTask
 * with the NMI mask ENABLED), so the vblank NMI CAN fire while this leaf executes.
 * Collapsing its per-instruction m.step charges to one per-branch total would move
 * where an NMI that lands inside it records the pushed PC, so the distribution is
 * NOT free here (README §2 + the ATOMICITY-IS-PER-CALL-PATH rule -- the same
 * reason sub_0008/0010/0018 were reverted). The charges are therefore left exactly
 * as the oracle emits them: ld de(10) / ld a,(nn)(13) / and a(4) / ret z(11 taken
 * | 5 not-taken) / ld de(10) / ret(10) -- branch totals 38 t (P1) and 52 t (P2),
 * preserved and identical to the oracle by construction.
 *
 * The optimization delivered on this tiny leaf is therefore NOT a cycle collapse
 * but the names (P1_SCORE / P2_SCORE / CURRENT_PLAYER), structured control flow,
 * and this documented contract; behaviour and cycle distribution are byte-for-byte
 * the oracle's.
 */
export function sub_055f(m) {
  const { regs, mem } = m;

  // ld de,0x60b2 -- DE = P1_SCORE (the default; may be overwritten below).
  regs.de = P1_SCORE;
  m.step(0x0562, 10);

  // ld a,(0x600d) / and a -- load CURRENT_PLAYER and set Z from it.
  regs.a = mem.read8(CURRENT_PLAYER);
  m.step(0x0565, 13);
  regs.and(regs.a); // Z from A; clears C, sets H -- also the observed F at both exits
  m.step(0x0566, 4);

  if (regs.fZ) {
    // ret z: player 0 -- keep DE = P1_SCORE. (branch total 10+13+4+11 = 38 t)
    m.ret(11);
    return;
  }
  m.step(0x0567, 5); // ret z not taken

  // ld de,0x60b5 -- DE = P2_SCORE, overwriting the P1 load.
  regs.de = P2_SCORE;
  m.step(0x056a, 10);

  m.ret(); // unconditional ret at 0x056a (default 10 t; total 10+13+4+5+10+10 = 52 t)
}

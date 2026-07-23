// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_1654 — hand-optimized rewrite of the translated routine at ROM 0x1654,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x1708, 0x004e, 0x1662) is reached through
 * `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to that callee's own optimized rewrite once one
 * exists — never a copy. The one work-RAM byte it writes is named from ram.js
 * (SUBSTATE_TIMER); its other operands (0x385C ROM template, the callee
 * addresses) stay hex.
 */

import { SUBSTATE_TIMER } from "./ram.js";

/**
 * sub_1654 -- 0x1644-sequence idx 0: spawn a board object, copy its template,
 * arm the sub-state timer, then fall through into the shared tail_1662.
 * [ROM 0x1654-0x1662; entry 0 of the 0x1623 rst-0x28 table, reached via
 * dispatchGameState -> loc_1615 (GAME_SUBSTATE 0x600A==0x16, board-advance) when
 * BOARD(0x6227) has bit0 SET (odd board, e.g. 25m/75m), indexed by the sequence
 * selector 0x6388==0.]
 *
 *   1654  cd 08 17   call 0x1708      ; spawn: stamp the 0x6A20 object record
 *                                     ;   (80 76 09 20), set 0x6905=0x13, draw a
 *                                     ;   colour column (via 0x0514), arm sound
 *                                     ;   0x608A/B = 07/03
 *   1657  21 5c 38   ld   hl,0x385c   ; HL = the 0x28-byte object template in ROM
 *   165a  cd 4e 00   call 0x004e      ; ldir 0x28 bytes 0x385C -> 0x6908
 *   165d  3e 20      ld   a,0x20
 *   165f  32 09 60   ld   (0x6009),a  ; SUBSTATE_TIMER = 0x20 (wait 32 frames)
 *   1662  ...        (fall through into tail_1662 @ 0x1662)
 *
 * WHAT IT DOES. One staging step of a board-advance: it kicks off the spawn of a
 * board object (0x1708), copies that object's 0x28-byte template from ROM 0x385C
 * into the live object block at 0x6908 (via the ldir helper 0x004e), and arms the
 * two-byte sub-state timer's high byte SUBSTATE_TIMER(0x6009) to 0x20 so the next
 * sub-state waits 32 frames. It then falls straight through into tail_1662, the
 * fragment shared with sub_168a, which advances the 0x6388 selector, runs the
 * rst-0x30 board-bit gate (a caller-skip), and rst-0x38.
 *
 * INPUTS: none of its own registers on entry (the first act is a call); it relies
 *   on the live board object context set up by earlier board play. OUTPUTS: the
 *   0x6A20 object record + 0x6905 + colour column + sound latches written by
 *   0x1708; the 0x6908 object block filled by the 0x004e ldir; SUBSTATE_TIMER
 *   (0x6009) = 0x20; plus everything tail_1662 writes (inc 0x6388, the 0x690B
 *   rst-0x38 add-chain). On the way into the tail HL = 0x3884 (0x385C advanced
 *   0x28 by the ldir) and A = 0x20.
 *
 * FLAGS / RETURN. sub_1654 ends with `return m.call(0x1662)` — the fall-through
 *   into tail_1662 is the routine's tail, and tail_1662's return value is the
 *   caller-skip signal (undefined when the rst-0x30 gate pops the caller, else the
 *   value of its final m.ret). That value is propagated verbatim, so the caller
 *   (the rst-0x28 dispatch in nmi.js) sees exactly what the oracle produced. The
 *   final register file — A/F included, which the unit gate compares — is set by
 *   tail_1662, run identically on both sides via the same m.call, so nothing of
 *   sub_1654's own flag state is observable and no flag is computed by hand here.
 *
 * ATOMIC — cycles collapsed to one charge per inter-call segment, TOTAL preserved.
 *   sub_1654 is dispatched INSIDE the vblank NMI (dispatchGameState, sibling entry
 *   to loc_1880 in the same 0x1615 dispatcher), where the NMI mask is held
 *   (entry_0066 clears 0x7D84), so the NMI can never land inside it OR any callee.
 *   Its internal cycle DISTRIBUTION is therefore unobservable and the per-
 *   instruction m.step charges collapse to a single per-segment total. The TOTAL
 *   is still load-bearing (as part of the NMI's cost it sets mainLoop's vblank-spin
 *   count, README §2), so every segment sum is preserved exactly and the whole-
 *   machine gate confirms it. Segment totals (t-states), own instructions only:
 *     S0 entry -> call 0x1708            = 17 (call)                = 17
 *     S1 call 0x1708 -> call 0x004e      = 10 (ld hl) + 17 (call)   = 27
 *     S2 call 0x004e -> fall into 0x1662 = 7 (ld a) + 13 (ld mem)   = 20
 *   own total 64, unchanged from the oracle's 17+10+17+7+13. No HARDWARE (0x7Dxx)
 *   write — the sole own store is work RAM SUBSTATE_TIMER(0x6009) — so there is no
 *   write-bus-cycle trace to preserve and the collapse is unconditional.
 */
export function sub_1654(m) {
  const { regs, mem } = m;

  // call 0x1708 -- spawn the board object (record + colour column + sound).
  m.push16(0x1657); // balances sub_1708's ret
  m.step(0x1708, 17); // call 0x1708 (17)
  m.call(0x1708);

  // ld hl,0x385C / call 0x004e -- ldir the 0x28-byte template into 0x6908.
  regs.hl = 0x385c;
  m.push16(0x165d); // balances sub_004e's ret
  m.step(0x004e, 27); // ld hl,0x385C (10) + call 0x004e (17)
  m.call(0x004e);

  // ld a,0x20 / ld (0x6009),a -- arm SUBSTATE_TIMER, then fall through to 0x1662.
  regs.a = 0x20;
  mem.write8(SUBSTATE_TIMER, regs.a); // SUBSTATE_TIMER = 0x20
  m.step(0x1662, 20); // ld a,0x20 (7) + ld (0x6009),a (13); PC -> tail_1662
  return m.call(0x1662); // propagate tail_1662's caller-skip return
}

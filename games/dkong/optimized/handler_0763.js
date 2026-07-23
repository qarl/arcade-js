// SPDX-License-Identifier: GPL-3.0-only
/**
 * handler_0763 — hand-optimized rewrite of the translated routine at ROM 0x0763,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its two callees (0x0020 the rst-0x20 prescaler gate, and
 * 0x0c92 the board-setup body) are reached through `m.call`, the routine registry
 * (games/dkong/routines.js), so each resolves to the oracle or to a future
 * optimized rewrite. Only the RAM names BOARD/LEVEL/LIVES are imported (from ram.js).
 */

import { BOARD, LEVEL, LIVES } from "./ram.js";

/**
 * handler_0763 -- game-state-1 (attract) sub-state 1: the TIMED ADVANCE that
 * resets to the board-1 baseline and (re)builds the demo board.  [ROM 0x0763-0x0778]
 *
 *   0763  e7           rst  0x20          ; two-level prescaler gate (0x6008,0x6009)
 *   0764  af           xor  a             ; A = 0
 *   0765  32 92 63     ld   (0x6392),a    ; 0x6392 := 0   (engine scratch, unnamed)
 *   0768  32 a0 63     ld   (0x63a0),a    ; 0x63A0 := 0   (engine scratch, unnamed)
 *   076b  3e 01        ld   a,0x01        ; A = 1
 *   076d  32 27 62     ld   (0x6227),a    ; BOARD := 1
 *   0770  32 29 62     ld   (0x6229),a    ; LEVEL := 1
 *   0773  32 28 62     ld   (0x6228),a    ; LIVES := 1
 *   0776  c3 92 0c     jp   0x0c92        ; TAIL jump into loc_0c92 (board build)
 *
 * WHAT IT DOES. Dispatched every attract frame from the 0x0748 sub-state table
 * (index 1, game state 1) while GAME_SUBSTATE (0x600A) == 1. It is GATED by the
 * `rst 0x20` two-level prescaler: sub_0020 decrements 0x6008 (SUBSTATE_TIMER_LO)
 * and, only when THAT underflows to 0, falls into sub_0018 to decrement 0x6009
 * (SUBSTATE_TIMER); the body runs ONLY on the single frame both counters expire
 * together (observed: every frame skips until the one frame 0x6008==1 && 0x6009==1).
 * On that frame it zeroes two engine-scratch bytes and stamps the fresh-game
 * baseline BOARD=1 / LEVEL=1 / LIVES=1, then TAIL-JUMPS to loc_0c92 (0x0C92),
 * which clears the playfield and builds the board (board-1 arm, since BOARD is 1).
 *
 * INPUTS:  0x6008/0x6009 (the prescaler pair, read+decremented inside m.call(0x0020)).
 * OUTPUTS: RAM 0x6392=0, 0x63A0=0, BOARD=1, LEVEL=1, LIVES=1 on the proceed branch;
 *          plus everything loc_0c92 writes (board build). A=1 and F=(xor a flags)
 *          are handed to loc_0c92, which overwrites them.
 *
 * TWO NAMED-RAM CAVEATS. 0x6392 and 0x63A0 stay hex: ram.js lists both under
 * "Deliberately unnamed" (0x63xx engine scratch, no re-derived meaning). BOARD/
 * LEVEL/LIVES are the evidenced names for 0x6227/0x6229/0x6228 (note the ROM
 * writes them in the order 0x6227, 0x6229, 0x6228 -- BOARD, LEVEL, LIVES -- kept
 * verbatim; the store order is load-bearing for the write trace).
 *
 * CALLING CONVENTION. `m.push16(0x0764)` before the rst models the rst-0x20 push
 * of the return address 0x0764; sub_0020 either pops it (skip: `pop hl / ret`
 * unwinds to our caller's caller) or lets sub_0018's `ret z` consume it (proceed),
 * so SP balances either way and the push must stay (the unit gate compares SP).
 * The final `jp 0x0c92` pushes nothing (tail jump), so there is NO push16 before
 * m.call(0x0c92); loc_0c92's own `ret` returns on this handler's behalf -- and the
 * oracle does NOT forward that return value (bare `m.call(0x0c92)`), which is
 * matched here (dispatchGameState/sub_0028 ignore this handler's return value).
 *
 * FLAGS. On skip, the boolean from m.call(0x0020) is the only thing consumed and
 * it is returned by the callee, not a flag. On proceed, `xor a` sets A=0 and the
 * flags; the stores and `ld a,0x01` leave those flags untouched, so loc_0c92 is
 * entered with A=1 and F=(xor a). The unit gate compares the whole register file
 * (F included), and both sides call loc_0c92 identically, so the reproduced
 * `regs.xor(regs.a)` keeps A and F byte-identical up to the tail call.
 *
 * ATOMIC / CYCLES -- COLLAPSED to one total per branch, harness-verified EQUAL.
 * handler_0763 runs INSIDE the vblank NMI (dispatched via dispatchGameState), so
 * no NMI can fire inside it -- it is atomic by the README §2 test. Its internal
 * cycle DISTRIBUTION is therefore free, while its TOTAL still feeds the spin count
 * (README §2: the NMI's total cost sets the main-loop spin, the PRNG's entropy).
 * So each branch charges its per-instruction tstate SUM once: the rst's own 11t
 * stays before m.call(0x0020) on BOTH branches (skip total = 11t), and the proceed
 * branch folds the body+jp (4+13+13+7+13+13+13 = 76, +10 for the jp = 86) into a
 * single m.step to the tail-jump target (proceed total = 11+86 = 97t, == the
 * oracle's per-instruction sum). Whole-machine EQUAL over 520 frames -- covering
 * the frame-518 proceed -- confirms the totals; a wrong total would surface at
 * SPIN_COUNT 0x6019 exactly as it did for handler_05c6 when stripped.
 */
export function handler_0763(m) {
  const { regs, mem } = m;

  // rst 0x20 -- two-level prescaler gate. Runs the body only when both 0x6008 and
  // 0x6009 expire on the same frame; otherwise sub_0020 unwinds to our caller's
  // caller and returns false. push16(0x0764) balances that rst's stack push.
  m.push16(0x0764);
  m.step(0x0020, 11); // rst 0x20 (skip branch total = 11t)
  if (!m.call(0x0020)) return; // prescalers not both expired -- skipped this frame

  // Proceed: reset to the board-1 fresh-game baseline.
  regs.xor(regs.a);          // A = 0, flags per `xor a`
  mem.write8(0x6392, regs.a); // 0x6392 := 0  (engine scratch, stays hex)
  mem.write8(0x63a0, regs.a); // 0x63A0 := 0  (engine scratch, stays hex)
  regs.a = 0x01;
  mem.write8(BOARD, regs.a);  // 0x6227 := 1
  mem.write8(LEVEL, regs.a);  // 0x6229 := 1
  mem.write8(LIVES, regs.a);  // 0x6228 := 1

  // jp 0x0c92 -- TAIL jump into the board builder; loc_0c92's ret returns for us.
  // Body(76t) + jp(10t) = 86t, collapsed to one charge to the jump target.
  m.step(0x0c92, 86);
  m.call(0x0c92);
}

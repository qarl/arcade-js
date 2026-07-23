// SPDX-License-Identifier: GPL-3.0-only
/**
 * handler_073c — hand-optimized rewrite of the translated routine at ROM 0x073C,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0028, the inline-jump-table trampoline)
 * is reached through `m.call`, the routine registry (games/dkong/routines.js), so
 * it resolves to the oracle or to a future optimized rewrite. Only RAM *names* are
 * imported (from ram.js).
 */

import { CREDITS, GAME_SUBSTATE, GAME_STATE } from "./ram.js";

// Label forwarded to sub_0028 (the rst 0x28 trampoline) so its error/site text
// names the correct dispatch site. Passed verbatim, exactly as the oracle does;
// inert unless a downstream dispatch fails. Kept as a local string because it is a
// site tag, not a RAM name.
const SUBSTATE_TABLE_073C = "0x0748 (game state 1 sub-state)";

/**
 * handler_073c -- game state 1 (ATTRACT): step to a credited game, else run the
 * attract sub-state.  [ROM 0x073C-0x0762]
 *
 *   073c  21 0a 60     ld   hl,0x600a          ; HL -> GAME_SUBSTATE
 *   073f  3a 01 60     ld   a,(0x6001)          ; A = CREDITS
 *   0742  a7           and  a                   ; test CREDITS, clear carry
 *   0743  c2 5c 07     jp   nz,0x075c           ; a credit is present -> advance
 *   0746  7e           ld   a,(hl)              ; A = GAME_SUBSTATE
 *   0747  ef           rst  0x28                ; dispatch via the 10-word table @0x0748
 *   0748  <table: 0779 0763 123c 1977 127c 07c3 07cb 084b 0000 0000>
 *   075c  36 00        ld   (hl),0x00           ; loc_075c: GAME_SUBSTATE = 0
 *   075e  21 05 60     ld   hl,0x6005           ; HL -> GAME_STATE
 *   0761  34           inc  (hl)                ; GAME_STATE++ (attract -> credited)
 *   0762  c9           ret
 *
 * WHAT IT DOES. This is the top-level handler for GAME_STATE == 1, the ATTRACT
 * state, dispatched every vblank by the NMI's rst 0x28 table at 0x00CA. It reads
 * CREDITS (0x6001):
 *   - CREDITS != 0 (a coin was accepted): reset the attract sub-state
 *     (GAME_SUBSTATE = 0) and INCREMENT the top-level GAME_STATE (0x6005) so the
 *     next NMI dispatches game state 2 (the credited-game entry). This is the
 *     step that walks the machine from attract to a credited game.
 *   - CREDITS == 0 (no coin): dispatch the current attract sub-state through the
 *     ROM's SECOND inline-jump-table (the ten words at 0x0748), the same rst 0x28
 *     idiom the NMI uses at 0x00C9. `rst 0x28` pops its own return address to find
 *     the table, so the words at 0x0748 are DATA and control never resumes there;
 *     sub_0028 reads the table from ROM and `jp (hl)` into the selected sub-state
 *     handler (0x0779/0x0763/... — two slots are unused 0x0000).
 *
 * INPUTS:  CREDITS (0x6001), GAME_SUBSTATE (0x600A) [only when no credit].
 * OUTPUTS: (credit)    GAME_SUBSTATE = 0, GAME_STATE (0x6005) incremented; HL = 0x6005.
 *          (no credit) A = the sub-state index, 0x0748 pushed as the table base,
 *                      then tail-dispatched into sub_0028.
 *
 * FLAGS. `and a` is KEPT (regs.and): it is the branch decider (the `jp nz` reads
 * its Z flag, modelled as `if (regs.fNZ)`), AND on the credit branch it CLEARS
 * CARRY, which the following `inc (hl)` then preserves into the final F -- the unit
 * gate compares F, so dropping `and a` would leak the entry carry into the result.
 * `incMem8` applies the exact Z80 inc flag semantics (S,Z,H,PV set, C preserved)
 * the oracle leaves in F at `ret`. On the no-credit branch, `ld a,(hl)` leaves the
 * `and a` flags untouched and sub_0028's first op (`add a,a`) immediately
 * overwrites F, so nothing between here and the call observes them; and HL (0x600A)
 * is dead because sub_0028's first act is `pop hl` -- so neither is re-set here.
 *
 * LADDER STATUS -- rung 5 (idiomatic), cycles collapsed to one total per branch.
 * handler_073c is ATOMIC in the strongest sense: it runs INSIDE the NMI, whose
 * entry (entry_0066) clears the NMI mask (xor a / ld (0x7d84),a), so the vblank NMI
 * can never re-enter while this routine executes -- no NMI ever lands between its
 * instructions (a stronger guarantee than entry_0611's, which merely relied on
 * being short in a main-loop context). NMI_CYCLE_IN_FRAME is 0, so the NMI fires
 * right after the frame sample and this ~55-78t routine finishes ~50k cycles before
 * the next boundary; no frame boundary falls inside it, so its internal cycle
 * DISTRIBUTION is unobservable. Its TOTAL is still load-bearing -- the NMI's total
 * cost sets the main-loop vblank-spin count, which is the PRNG entropy (README §2,
 * SPIN_COUNT/RANDOM) -- so each branch's exact per-instruction sum is charged once:
 *   - credit branch     78t (10+13+4+10+10+10+11+10) in the single m.ret(78).
 *   - no-credit branch  55t (10+13+4+10+7+11) in one m.step(0x0028, 55) right
 *                       before m.call(0x0028); sub_0028 and the sub-state handler
 *                       keep their own per-instruction charges (separate m.call'd
 *                       routines), so the NMI total is preserved EXACTLY.
 * Harness-verified: the natural attract run drives the no-credit branch every frame
 * (whole-machine EQUAL); a CREDITS poke drives the credit branch under live NMI
 * timing (whole-machine EQUAL) -- both stay EQUAL, confirming the collapse.
 */
export function handler_073c(m) {
  const { regs, mem } = m;

  // ld a,(CREDITS) / and a -- test for a pending credit; and a also clears carry.
  regs.a = mem.read8(CREDITS);
  regs.and(regs.a);

  if (regs.fNZ) {
    // jp nz taken: a credit is present. Reset the attract sub-state and advance
    // the top-level game state so the next NMI enters the credited game.
    mem.write8(GAME_SUBSTATE, 0x00); // ld (hl),0x00  (hl == 0x600A)
    regs.hl = GAME_STATE; // ld hl,0x6005
    regs.incMem8(mem, regs.hl); // inc (hl)  -- GAME_STATE++, C preserved
    m.ret(78); // credit-branch total: 10+13+4+10+10+10+11+10
    return;
  }

  // jp nz not taken: no credit. Dispatch the current attract sub-state through the
  // inline jump table at 0x0748 (rst 0x28 pushes the table base as its ret addr).
  regs.a = mem.read8(GAME_SUBSTATE); // ld a,(hl)  -- sub-state index
  m.push16(0x0748); // rst 0x28 pushes the table base
  m.step(0x0028, 55); // no-credit total 0x073C..0x0747: 10+13+4+10+7+11
  m.call(0x0028, SUBSTATE_TABLE_073C);
}

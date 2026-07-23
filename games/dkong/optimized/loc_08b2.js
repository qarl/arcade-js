// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_08b2 — hand-optimized rewrite of the translated routine at ROM 0x08B2,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0028, the rst-0x28 jump-table
 * trampoline) is reached through `m.call`, the routine registry
 * (games/dkong/routines.js), so it resolves to the oracle or to a future
 * optimized rewrite. Only the RAM name GAME_SUBSTATE is imported (from ram.js).
 */

import { GAME_SUBSTATE } from "./ram.js";

/**
 * loc_08b2 -- game state 2 (GAMEPLAY) entry: dispatch on the sub-state byte.
 * [ROM 0x08B2-0x08B5]
 *
 *   08b2  3a 0a 60     ld   a,(0x600a)   ; A = GAME_SUBSTATE
 *   08b5  ef           rst  0x28         ; -> inline jump table at 0x08B6, 2 entries
 *
 * The whole routine is a TWO-INSTRUCTION TAIL DISPATCH, the same idiom as
 * loc_06fe (state 3, table 0x0702) and loc_0a76 (0x6385, table 0x0A7A): read
 * the sub-state selector into A, then `rst 0x28`. The rst PUSHES its own return
 * address -- which for this idiom is the TABLE BASE 0x08B6, not the next
 * instruction -- and jumps to the trampoline sub_0028 (0x0028). sub_0028 does
 * `add a,a` (index*2), `pop hl` (recovers the table base it was handed),
 * indexes the 2-entry word table, and `jp (hl)` to the selected arm:
 *   A == 0 -> 0x08BA (loc_08ba)  -- sub-state 0
 *   A == 1 -> 0x08F8 (loc_08f8)  -- sub-state 1
 * There is NO range check (as in loc_06fe): A >= 2 would index off the 2-entry
 * table. The ROM only ever holds 0 or 1 here while GAME_STATE == 2, so those
 * are the only reachable arms. This is a TAIL dispatch -- the selected arm ends
 * in its own `ret`, which returns to loc_08b2's caller (dispatchGameState),
 * NOT here -- so loc_08b2 issues no `m.ret` of its own and does not return the
 * dispatched value (the oracle discards it; dispatchGameState's 0x08b2 arm
 * therefore yields undefined, and nothing consumes it).
 *
 * INPUTS:  GAME_SUBSTATE (0x600A) -- the selector, read into A.
 * OUTPUTS: none written here; A is left = the selector (sub_0028 consumes it via
 *   `add a,a`). The push16(0x08B6) writes the table base to the stack; sub_0028's
 *   `pop hl` consumes it (the popped bytes stay resident below SP, as the Z80
 *   never clears them -- part of the diffed work RAM, matched by construction).
 *   All RAM the invocation mutates is written by the dispatched arm, not here.
 *
 * FLAGS: none set by this routine's own instructions (`ld a` and `rst` touch no
 *   flags); sub_0028's `add a,a` / `add hl,de` set the flags the arm sees. So
 *   there is no flag of ours for a caller to consume -- the unit gate (which
 *   compares the whole register file incl. F) confirms it. A is left = selector.
 *
 * LADDER STATUS -- rung 4 (idiomatic), cycles collapsed to one total charge.
 * loc_08b2 runs INSIDE the vblank NMI (dispatchGameState is reached from the NMI
 * handler entry_0066, whose first act clears the NMI mask 0x7D84), so no nested
 * NMI can fire while it executes: it is ATOMIC. Its internal cycle distribution
 * is therefore free, and the two prologue charges (ld a = 13, rst = 11) collapse
 * to a single m.step of 24 -- harness-verified EQUAL whole-machine AND unit. The
 * TOTAL is still load-bearing, as always: this frame's NMI cost sets the main
 * loop's vblank-spin count, which is the PRNG's entropy (README §2 / handler_05c6
 * / SPIN_COUNT 0x6019); stripping the 24 would reseed the RNG and diverge. This
 * NMI's total cost also fixes where a LATER frame's vblank NMI lands in the diffed
 * stack RAM (a cheaper frame shifts the cumulative cycle count), exactly the
 * entry_0611 downstream-landing mechanism -- nothing here is itself interruptible
 * (the NMI runs with its mask cleared). So: collapse = win (verified), drop = wrong.
 * The push16/step/call scaffolding of the rst calling convention stays -- sub_0028's
 * `pop hl` needs the pushed base.
 */
export function loc_08b2(m) {
  const { regs, mem } = m;

  // ld a,(GAME_SUBSTATE) -- the 2-entry jump-table selector (0 or 1).
  regs.a = mem.read8(GAME_SUBSTATE);

  // rst 0x28 -- TAIL dispatch through the inline table at 0x08B6. rst pushes the
  // table base as its "return address"; sub_0028 pops it, indexes, and jp (hl).
  // Collapsed prologue charge: 13 (ld a) + 11 (rst) = 24 t, one m.step (atomic).
  m.push16(0x08b6);
  m.step(0x0028, 24);
  m.call(0x0028, "0x08B6 (0x600A, 2-entry)");
}

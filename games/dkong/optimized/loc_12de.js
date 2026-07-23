// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_12de — hand-optimized rewrite of the translated routine at ROM 0x12DE,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Both callees (0x0018, the `rst 0x18` gate; 0x30DB,
 * entry_30db) are reached through `m.call`, the routine registry
 * (games/dkong/routines.js), so each resolves to the oracle — or to a future
 * optimized rewrite — never a copy. Only the RAM names GAME_SUBSTATE and
 * SUBSTATE_TIMER are imported (from ram.js).
 */

import { GAME_SUBSTATE, SUBSTATE_TIMER } from "./ram.js";

/**
 * loc_12de -- 0x639D dispatch arm 2: advance GAME_SUBSTATE, re-arm the gate.
 * [ROM 0x12DE-0x12F1]
 *
 *   12de  df           rst  0x18            ; gate on SUBSTATE_TIMER (0x6009)
 *   12df  cd db 30     call 0x30db          ; entry_30db (zeros 0x694C, 0x6958..0x696C)
 *   12e2  21 0a 60     ld   hl,0x600a       ; HL = GAME_SUBSTATE
 *   12e5  3a 0e 60     ld   a,(0x600e)      ; A = player index
 *   12e8  a7           and  a
 *   12e9  ca ed 12     jp   z,0x12ed        ; player 1 -> one inc; player 2 -> two
 *   12ec  34           inc  (hl)            ; the EXTRA inc (player 2 only)
 *   12ed  34           inc  (hl)            ; ALWAYS
 *   12ee  2b           dec  hl              ; GAME_SUBSTATE -> SUBSTATE_TIMER
 *   12ef  36 01        ld   (hl),0x01       ; SUBSTATE_TIMER = 1 -> next rst 0x18 expires now
 *   12f1  c9           ret
 *
 * WHAT IT DOES. Reached as table[2] of the 0x639D rst-0x28 dispatch (entry_127f,
 * ROM 0x1283), the arm that loc_12ac's advance branch bumps the state into. Every
 * time the `rst 0x18` gate on SUBSTATE_TIMER (0x6009) EXPIRES it:
 *   1. calls entry_30db (clears the 0x694C animation cell and the six-cell block
 *      0x6958/5C/60/64/68/6C -- object scratch this state is done with),
 *   2. advances GAME_SUBSTATE (0x600A) -- by ONE for a 1-player game, by TWO for a
 *      2-player game (0x600E != 0 adds the extra inc), and
 *   3. re-arms SUBSTATE_TIMER (0x6009) to 1 so the very next `rst 0x18` expires
 *      immediately -- handing control straight on to the newly-selected substate.
 * When the gate has NOT expired, sub_0018 discards this routine's return address
 * and control skips to the caller's caller: the dispatch is abandoned this frame
 * and nothing here runs.
 *
 * INPUTS  (RAM read):  SUBSTATE_TIMER (0x6009, via the rst-0x18 gate), 0x600E
 *                      (player index). (entry_30db reads/writes its own scratch.)
 * OUTPUTS (RAM write): GAME_SUBSTATE (0x600A), SUBSTATE_TIMER (0x6009); plus the
 *                      cells entry_30db clears (through the m.call to the oracle).
 *
 * NAMES. 0x600A and 0x6009 are evidenced (GAME_SUBSTATE / SUBSTATE_TIMER, ram.js).
 * 0x600E (the player index) is unnamed in ram.js, so it stays hex -- a wrong name
 * is worse than hex (README §4).
 *
 * REGISTER / FLAG OPS. The routine ends in a plain `ret` (no `ret cc`), so no flag
 * is a return value; but the unit gate compares the WHOLE register file incl. F,
 * so the finish state must match. The final flags are set by the ALWAYS `inc (hl)`
 * at 0x12ED (the later `dec hl` is 16-bit and sets no flags; `ld (hl),0x01` sets
 * none), so both `inc (hl)` stores use regs.inc8 to reproduce those flags exactly.
 * `and a`'s flags are dead (overwritten by the inc on BOTH paths) but it is kept
 * as the branch test -- it also leaves A unchanged, which A must be at the ret.
 * A ends = the 0x600E value read; HL ends = SUBSTATE_TIMER (0x6009); every other
 * register is whatever the identical entry_30db callee left.
 *
 * ATOMIC / CYCLES — collapsed to one total per branch. loc_12de runs INSIDE the
 * NMI handler (dispatchGameState), where the hardware NMI mask is already cleared,
 * so no NMI can fire inside it; and NMI_CYCLE_IN_FRAME=0 puts the handler ~50688
 * cycles from the next frame boundary, so no state-dump capture lands mid-routine
 * either. Neither callee re-enables the NMI mask, so the whole routine is atomic
 * and its per-instruction m.step distribution is unobservable. The post-gate,
 * post-call tail is therefore collapsed into a single charge folded onto the ret:
 * player-1 tail total 74 (10+13+4+10 + 11+6+10 + 10), player-2 tail total 85
 * (adds the extra inc's 10+11). The two CALL instructions keep their own charge
 * BEFORE the m.call (calling convention): rst 0x18 = 11t, call 0x30db = 17t. So
 * each branch's TOTAL own-cost is preserved exactly (gate-skip 11; player-1
 * 11+17+74 = 102; player-2 11+17+85 = 113) -- load-bearing because the NMI
 * handler's cost sets the main-loop spin count that seeds the PRNG (README §2).
 * Harness-verified EQUAL whole-machine + unit; each branch's collapsed cycle total
 * is re-asserted against the oracle in the branch-coverage tests.
 */
export function loc_12de(m) {
  const { regs, mem } = m;

  // rst 0x18: tick SUBSTATE_TIMER (0x6009). If it has NOT expired, sub_0018
  // discards our return address and control skips to our caller's caller -- the
  // dispatch is abandoned this frame. 11t is the rst instruction itself.
  m.push16(0x12df);
  m.step(0x0018, 11);
  if (!m.call(0x0018)) return;

  // call 0x30db: entry_30db clears the 0x694C cell + the 0x6958.. block, then its
  // ret returns here. 17t is the call instruction itself.
  m.push16(0x12e2);
  m.step(0x30db, 17);
  m.call(0x30db);

  // ---- advance GAME_SUBSTATE, re-arm SUBSTATE_TIMER (tail 0x12E5..0x12F1) ----
  regs.hl = GAME_SUBSTATE; // 0x600A
  regs.a = mem.read8(0x600e); // player index (unnamed -> hex)
  regs.and(regs.a); // Z = player 1; flags dead after the inc but kept, A unchanged
  const player2 = regs.fNZ; // branch AND tail-total decider -- captured before inc8 clobbers F

  if (player2) {
    // player 2: the EXTRA inc of GAME_SUBSTATE (inc8 for the flags/value)
    mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
  }
  // ALWAYS inc GAME_SUBSTATE -- this inc's flags are the routine's final F.
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));

  regs.hl = (regs.hl - 1) & 0xffff; // dec hl -- 16-bit, no flags. HL = SUBSTATE_TIMER (0x6009)
  mem.write8(regs.hl, 0x01); // SUBSTATE_TIMER = 1 -> next rst 0x18 expires immediately

  // Collapsed tail total, folded onto the ret (atomic; see header). player 1 = 74,
  // player 2 adds the extra inc's jp-not-taken 10 + inc 11 = 85.
  m.ret(player2 ? 85 : 74);
}

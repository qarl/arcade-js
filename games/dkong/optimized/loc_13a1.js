// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_13a1 — hand-optimized rewrite of the translated routine at ROM 0x13A1,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0018, the `rst 0x18` gate) is reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so it
 * resolves to the oracle — or to a future optimized rewrite — never a copy. Only
 * the RAM names P1_CONTEXT and GAME_SUBSTATE are imported (from ram.js).
 */

import { P1_CONTEXT, GAME_SUBSTATE } from "./ram.js";

/**
 * loc_13a1 -- 0x0702 table idx 0x11 (decimal 17): counter-gated substate select.
 * [ROM 0x13A1-0x13A9, converging on the loc_1395 tail 0x1395-0x13A0]
 *
 *   13a1  df           rst  0x18            ; gate on SUBSTATE_TIMER (0x6009)
 *   13a2  0e 17        ld   c,0x17
 *   13a4  3a 40 60     ld   a,(0x6040)      ; A = P1_CONTEXT[0] (P1's saved LIVES)
 *   13a7  c3 95 13     jp   0x1395          ; converge on the shared loc_1395 tail
 *   ---- loc_1395 tail (shared with loc_138f; HL == 0x6009 from sub_0018) ----
 *   1395  34           inc  (hl)            ; re-arm SUBSTATE_TIMER (0 -> 1)
 *   1396  a7           and  a               ; test the P1_CONTEXT byte
 *   1397  c2 9c 13     jp   nz,0x139c       ; nonzero -> keep C = 0x17
 *   139a  0e 14        ld   c,0x14          ; zero    -> C = 0x14 (falls through)
 *   139c  79           ld   a,c
 *   139d  32 0a 60     ld   (0x600a),a      ; GAME_SUBSTATE := 0x17 or 0x14
 *   13a0  c9           ret
 *
 * WHAT IT DOES. Reached as table[0x11] of loc_06fe's 0x0702 rst-0x28 substate
 * dispatch (GAME_STATE 3, GAME_SUBSTATE 0x600A == 0x11); it is the TWIN of
 * loc_138f (idx 0x10), which reads P2's context byte 0x6048 instead. Every time
 * its `rst 0x18` gate on SUBSTATE_TIMER (0x6009) EXPIRES it:
 *   1. re-arms SUBSTATE_TIMER (0x6009) via `inc (hl)` -- sub_0018 leaves HL =
 *      0x6009 and its `dec (hl)` took the byte to 0, so this puts it back to 1 so
 *      the gate expires again next frame (the substate re-runs each frame), and
 *   2. sets GAME_SUBSTATE (0x600A) to 0x17 when the P1_CONTEXT byte (0x6040, P1's
 *      saved LIVES) is NON-zero, else to 0x14 -- selecting the next substate.
 * When the gate has NOT expired, sub_0018 discards this routine's return address
 * and control skips to the caller's caller: the dispatch is abandoned this frame
 * and nothing here runs.
 *
 * INPUTS  (RAM read):  SUBSTATE_TIMER (0x6009, via the rst-0x18 gate), P1_CONTEXT
 *                      (0x6040 = P1's saved LIVES, the branch decider).
 * OUTPUTS (RAM write):  SUBSTATE_TIMER (0x6009, re-armed to 1), GAME_SUBSTATE
 *                      (0x600A). Both are WORK RAM -- no 0x7Dxx hardware latch is
 *                      written, so there is no write-bus-cycle trace to preserve
 *                      and no write-trace test is needed.
 *
 * NAMES. 0x6040 and 0x600A are evidenced (P1_CONTEXT / GAME_SUBSTATE, ram.js).
 * 0x6009 (re-armed via the HL sub_0018 leaves) is SUBSTATE_TIMER; it is not
 * hardcoded here -- it rides in regs.hl -- so it needs no import.
 *
 * REGISTER / FLAG OPS. The routine ends in a plain `ret` (no `ret cc`), so no flag
 * is a return value; but the unit gate compares the WHOLE register file incl. F,
 * so the finish state must match. The last flag-affecting op is `and a` (on the
 * P1_CONTEXT byte); everything after it -- `ld c,0x14`, `ld a,c`, `ld (0x600a),a`,
 * `ret` -- leaves F alone, so F ends = the `and a` result. `and a` also leaves A
 * unchanged, so it is kept verbatim (regs.and) rather than a bare compare. The
 * dead `inc (hl)` flags (overwritten by `and a`) still come from regs.inc8 so the
 * 0x6009 byte lands the same value. Finish state: A = C = 0x17/0x14, HL = 0x6009,
 * F = `and a` on 0x6040; B/DE/etc. are whatever sub_0018 left.
 *
 * ATOMIC / CYCLES — collapsed to one total per branch. loc_13a1 runs INSIDE the
 * NMI handler (dispatchGameState), where the hardware NMI mask is already cleared
 * (entry_0066), so no NMI can fire inside it; its only callee, sub_0018, does not
 * re-enable the mask. So the whole routine is atomic and its per-instruction
 * m.step distribution is unobservable. The post-gate tail is therefore collapsed
 * into a single charge folded onto the ret:
 *   nonzero branch (C = 0x17): 7+13+10+11+4 (common) + 10 (jp nz taken)   + 4+13+10 = 82
 *   zero    branch (C = 0x14): 7+13+10+11+4 (common) + 10+7 (jp nz + ld c) + 4+13+10 = 89
 * The `rst 0x18` keeps its own 11t charge BEFORE the m.call (calling convention).
 * So each branch's TOTAL own-cost is preserved exactly (gate-skip 11; nonzero
 * 11+82 = 93; zero 11+89 = 100) -- load-bearing because the NMI handler's cost
 * sets the main-loop spin count that seeds the PRNG (README §2). Harness-verified
 * EQUAL whole-machine + unit; each branch's collapsed cycle total is re-asserted
 * against the oracle in the branch-coverage tests. (Same family + finding as its
 * sibling loc_12de.)
 */
export function loc_13a1(m) {
  const { regs, mem } = m;

  // rst 0x18: tick SUBSTATE_TIMER (0x6009). If it has NOT expired, sub_0018
  // discards our return address and control skips to our caller's caller -- the
  // dispatch is abandoned this frame. 11t is the rst instruction itself; sub_0018
  // charges its own cycles through the m.call.
  m.push16(0x13a2);
  m.step(0x0018, 11);
  if (!m.call(0x0018)) return;

  // sub_0018 left HL = 0x6009 (SUBSTATE_TIMER). Tail (converges on loc_1395):
  regs.c = 0x17;
  regs.a = mem.read8(P1_CONTEXT); // 0x6040 -- P1's saved LIVES, the branch decider

  // inc (hl): re-arm SUBSTATE_TIMER (0 -> 1). inc8 for the byte value; its flags
  // are dead (overwritten by `and a` next) but reproduced for exactness.
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));

  regs.and(regs.a); // and a -- test the P1_CONTEXT byte; sets the routine's final F
  const nz = regs.fNZ; // branch + tail-total decider, captured before any later op

  if (!nz) regs.c = 0x14; // zero -> C = 0x14; nonzero keeps C = 0x17
  regs.a = regs.c; // ld a,c
  mem.write8(GAME_SUBSTATE, regs.a); // 0x600A := 0x17 or 0x14

  // Collapsed tail total, folded onto the ret (atomic; see header): 82 nonzero, 89 zero.
  m.ret(nz ? 82 : 89);
}

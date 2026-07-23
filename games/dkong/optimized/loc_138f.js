// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_138f — hand-optimized rewrite of the translated routine at ROM 0x138F,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0018, the `rst 0x18` gate) is reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so it
 * resolves to the oracle — or to a future optimized rewrite — never a copy. Only
 * the RAM names GAME_SUBSTATE, SUBSTATE_TIMER and P2_CONTEXT are imported (ram.js).
 */

import { GAME_SUBSTATE, SUBSTATE_TIMER, P2_CONTEXT } from "./ram.js";

/**
 * loc_138f -- 0x0702 table idx16 (GAME_SUBSTATE == 0x10): a gate-clocked phase
 * setter that arms the NEXT substate to 0x17 or 0x14 per the P2 context byte.
 * [ROM 0x138F-0x13A0]
 *
 *   138f  df           rst  0x18          ; gate on SUBSTATE_TIMER (0x6009)
 *   1390  0e 17        ld   c,0x17
 *   1392  3a 48 60     ld   a,(0x6048)     ; A = P2_CONTEXT byte
 *   1395  34           inc  (hl)           ; loc_1395 -- re-arm SUBSTATE_TIMER (HL=0x6009 from sub_0018)
 *   1396  a7           and  a              ; test the P2_CONTEXT byte
 *   1397  c2 9c 13     jp   nz,0x139c      ; != 0 -> C stays 0x17
 *   139a  0e 14        ld   c,0x14         ; else  C = 0x14 (falls through)
 *   139c  79           ld   a,c
 *   139d  32 0a 60     ld   (0x600a),a     ; GAME_SUBSTATE := 0x17 or 0x14
 *   13a0  c9           ret
 *
 * WHAT IT DOES. Reached as entry 16 (0x10) of loc_06fe's 0x0702 rst-0x28 table,
 * dispatched from INSIDE the NMI while GAME_STATE(0x6005)==3 and GAME_SUBSTATE
 * (0x600A)==0x10. Every time the `rst 0x18` gate on SUBSTATE_TIMER (0x6009)
 * EXPIRES it:
 *   1. re-arms SUBSTATE_TIMER (0x6009) with `inc (hl)` (sub_0018 left HL=0x6009
 *      and decremented it to 0 on expiry, so this bumps it 0 -> 1, meaning the
 *      very next `rst 0x18` expires again immediately), and
 *   2. advances GAME_SUBSTATE (0x600A) to 0x17 when the P2_CONTEXT byte (0x6048)
 *      is non-zero, else to 0x14 -- selecting the next 0x0702 phase (idx 0x17 vs
 *      idx 0x14). In a 1-player game 0x6048 is 0, so the 0x14 arm is the one the
 *      live game takes; the 0x17 arm is a 2-player context.
 * When the gate has NOT expired, sub_0018 discards this routine's return address
 * and control skips to the caller's caller: the dispatch is abandoned this frame
 * and nothing here runs (early return, no writes).
 *
 * INPUTS  (RAM read):  SUBSTATE_TIMER (0x6009, via the rst-0x18 gate),
 *                      P2_CONTEXT (0x6048, the arm selector).
 * OUTPUTS (RAM write): SUBSTATE_TIMER (0x6009, re-armed 0 -> 1),
 *                      GAME_SUBSTATE  (0x600A, := 0x17 or 0x14).
 * NO HARDWARE WRITE. Both stores are work RAM (0x60xx); nothing touches a 0x7Dxx
 * board latch, so there is no bus-cycle-positioned hardware write to preserve and
 * no --writes trace at stake (contrast optimized/loc_0a8a.js).
 *
 * NAMES. 0x6009/0x600A/0x6048 are evidenced (SUBSTATE_TIMER / GAME_SUBSTATE /
 * P2_CONTEXT, ram.js). The 0x17 / 0x14 arm values are the next substate indices,
 * left as literals (they ARE the numbers the ROM stores).
 *
 * REGISTER / FLAG OPS. The routine ends in a plain `ret` (no `ret cc`), so no flag
 * is a return value; but the unit gate compares the WHOLE register file incl. F,
 * so the finish state must match. The FINAL flags are set by `and a` (0x1397) on
 * the P2_CONTEXT byte -- the later `ld a,c` / `ld (0x600a),a` set none -- so the
 * timer re-arm is a plain increment (its `inc (hl)` flags are immediately dead,
 * overwritten by the `and`) and `regs.and(regs.a)` is kept verbatim as BOTH the
 * branch test and the source of the final F. `and a` leaves A unchanged (= the
 * 0x6048 byte), then `ld a,c` sets A = C, so A ends = C = 0x17 or 0x14; C ends the
 * same; HL ends = SUBSTATE_TIMER (0x6009), left by sub_0018 and never moved here;
 * every other register is whatever the identical sub_0018 callee left.
 *
 * ATOMIC / CYCLES — collapsed to one total per branch. loc_138f runs INSIDE the
 * NMI handler (dispatchGameState -> loc_06fe rst-0x28), where the hardware NMI
 * mask is already cleared (no nested NMI) and NMI_CYCLE_IN_FRAME=0 puts the
 * handler a full frame from the next boundary (no mid-routine state-dump capture).
 * Its one callee, sub_0018, is a non-interruptible leaf and re-enables no mask, so
 * the whole routine is atomic and its per-instruction m.step DISTRIBUTION is
 * unobservable. The post-gate tail is therefore collapsed into a single charge
 * folded onto the ret: arm 0x17 total 72 (7+13+11+4 + 10 + 4+13+10), arm 0x14
 * total 79 (adds the jp-not-taken 10 -> then ld c,0x14 = 7 in place of the taken
 * jp's 10, i.e. 7+13+11+4 + 10+7 + 4+13+10). The gate keeps its own charge BEFORE
 * the m.call (the rst 0x18 instruction = 11t), per the calling convention. So each
 * branch's TOTAL own-cost is preserved exactly (gate-skip 11; arm 0x17 11+72=83;
 * arm 0x14 11+79=90) -- load-bearing because the NMI handler's cost sets the
 * main-loop spin count that seeds the PRNG (README §2). Harness-verified EQUAL
 * whole-machine + unit; each branch's collapsed cycle total is re-asserted against
 * the oracle in the branch-coverage tests.
 */
export function loc_138f(m) {
  const { regs, mem } = m;

  // rst 0x18: tick SUBSTATE_TIMER (0x6009). If it has NOT expired, sub_0018
  // discards our return address and control skips to our caller's caller -- the
  // dispatch is abandoned this frame. 11t is the rst instruction itself.
  m.push16(0x1390);
  m.step(0x0018, 11);
  if (!m.call(0x0018)) return;

  // ---- re-arm the timer, select the next substate (tail 0x1392..0x13A0) ----
  regs.c = 0x17; // ld c,0x17 -- the default arm value
  regs.a = mem.read8(P2_CONTEXT); // A = the 0x6048 selector byte

  // inc (hl): re-arm SUBSTATE_TIMER (sub_0018 left HL=0x6009 and dec'd it to 0).
  // The inc's flags are dead -- `and a` below overwrites them -- so a plain
  // increment suffices; A is untouched, so it is still the 0x6048 byte.
  mem.write8(SUBSTATE_TIMER, (mem.read8(SUBSTATE_TIMER) + 1) & 0xff);

  regs.and(regs.a); // test the 0x6048 byte -- sets the routine's FINAL F, leaves A
  if (!regs.fNZ) regs.c = 0x14; // 0x6048 == 0 -> the 0x14 arm

  regs.a = regs.c; // ld a,c
  mem.write8(GAME_SUBSTATE, regs.a); // 0x600A := 0x17 (non-zero) or 0x14 (zero)

  // Collapsed tail total, folded onto the ret (atomic; see header):
  // arm 0x17 = 72, arm 0x14 = 79 (the not-taken jp adds ld c,0x14's 7t).
  m.ret(regs.fNZ ? 72 : 79);
}

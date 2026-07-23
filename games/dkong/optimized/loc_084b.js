// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_084b — hand-optimized rewrite of the translated routine at ROM 0x084b,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0020, the `rst 0x20` prescaler helper)
 * is reached through `m.call`, the routine registry (games/dkong/routines.js), so
 * it resolves to the oracle or to a future optimized rewrite. Only the RAM name
 * GAME_SUBSTATE is imported (from ram.js).
 */

import { GAME_SUBSTATE } from "./ram.js";

/**
 * loc_084b -- game-state-1 sub-state 7: a two-prescaler timed gate that clears
 * the sub-state index once both prescalers expire.
 * [ROM 0x084b-0x0851]
 *
 *   084b  e7           rst  0x20          ; skip unless BOTH prescalers expire
 *   084c  21 0a 60     ld   hl,0x600a
 *   084f  36 00        ld   (hl),0x00     ; GAME_SUBSTATE (0x600A) = 0
 *   0851  c9           ret
 *
 * WHAT IT DOES. Dispatched by handler_073c (game state 1) as entry 7 of the
 * 0x0748 sub-state table -- i.e. it runs only while GAME_STATE (0x6005) == 1 and
 * GAME_SUBSTATE (0x600A) == 7. It is a TIMED ADVANCE: `rst 0x20` (sub_0020) runs
 * the two-level countdown 0x6008 (fast prescaler) -> 0x6009 (slow prescaler) and
 * returns to us ONLY when BOTH underflow on the same tick; on any earlier tick it
 * discards our return address and returns to OUR caller's caller (the "skip"),
 * leaving 0x600A untouched. When both expire, control falls through and we zero
 * GAME_SUBSTATE, ending the wait so the state machine can move on.
 *
 * INPUTS (read):  the prescalers 0x6008 / 0x6009 (read+decremented inside sub_0020
 *                 / sub_0018, not here); the pushed return address on the stack.
 * OUTPUTS (write): on the expire branch, GAME_SUBSTATE (0x600A) <- 0. On the skip
 *                 branch, no store of our own (sub_0020/sub_0018 tick a prescaler
 *                 and unwind the stack).
 *
 * CALLEE VIA m.call. The `rst 0x20` target 0x0020 is invoked as `m.call(0x0020)`
 * so it resolves to the oracle (or a future optimized rewrite). Its `push16` /
 * pre-call cycle charge stay at the call site (calling convention, README §"the
 * calling convention is not scaffolding"). `m.call(0x0020)` returns a boolean --
 * the rst skip-idiom -- false when control already unwound to our caller's caller
 * (skip), true when it came back to us (expire); we forward that as an early
 * return exactly like the oracle.
 *
 * FLAGS. loc_084b's own instructions (ld hl,nn / ld (hl),n / ret) touch NO flags,
 * so F is whatever sub_0020/sub_0018 left (Z set from the expiring `dec (hl)` on
 * the expire branch). This rewrite likewise never writes F, so it matches the
 * oracle bit-for-bit; the unit gate compares the whole register file, F included.
 * HL is left = 0x600A on the expire branch (set by `ld hl,0x600a`); the unit gate
 * compares HL too, so the assignment is kept verbatim.
 *
 * ATOMIC / CYCLES -- collapsed to one total per branch, harness-verified EQUAL.
 * loc_084b is dispatched from INSIDE the NMI (dispatchGameState), where the NMI
 * mask is held, so the vblank NMI can never land inside it: it is ATOMIC and its
 * internal cycle DISTRIBUTION is free. The TOTAL per branch is still preserved
 * (README §2) -- the NMI's cumulative cycles feed mainLoop's vblank-spin count,
 * which is the PRNG entropy, so a cheaper routine would reseed the RNG and diverge
 * at 0x6019. Charges kept, redistributed:
 *   - skip branch: the single `rst 0x20` charge (11 t) before the call, then the
 *     early return -- already one charge, nothing to collapse.
 *   - expire branch: 11 t (rst, pre-call, kept as scaffolding) + the post-call body
 *     `ld hl` 10 + `ld (hl),0` 10 + `ret` 10 = 30, folded into one `m.ret(30)`
 *     (the same idiom as entry_0611's `m.ret(28)`). Total per branch identical to
 *     the oracle; whole-machine + unit both stay EQUAL (if the collapse diverged,
 *     the rule is to revert to per-instruction -- it did not).
 */
export function loc_084b(m) {
  const { regs, mem } = m;

  // rst 0x20 -- run the two-prescaler countdown. push16 + pre-call cycle charge
  // are the calling convention; the boolean is the rst skip-idiom.
  m.push16(0x084c); // rst 0x20 pushes its own return address (0x084C)
  m.step(0x0020, 11); // rst 0x20
  if (!m.call(0x0020)) return; // skipped: control unwound to our caller's caller, 0x600A untouched

  // Both prescalers expired -- end the wait: GAME_SUBSTATE <- 0.
  regs.hl = GAME_SUBSTATE; // ld hl,0x600a (HL is compared, so set it verbatim)
  mem.write8(regs.hl, 0x00); // ld (hl),0x00
  m.ret(30); // ret -- one folded charge: ld hl 10 + ld (hl) 10 + ret 10 = 30 t
}

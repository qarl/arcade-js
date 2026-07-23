// SPDX-License-Identifier: GPL-3.0-only
/**
 * entry_128b — hand-optimized rewrite of the translated routine at ROM 0x128B,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its two callees — 0x0018 (the rst-0x18 substate-timer
 * skip helper) and 0x30BD (the four-run work-RAM clear) — are reached through
 * `m.call`, the routine registry (games/dkong/routines.js), so each resolves to
 * the oracle, or to a future optimized rewrite, and is never copied. Only RAM
 * *names* are imported (ram.js); the two 0x63xx animation scratch bytes and the
 * blinker cell are un-evidenced in this context and stay hex.
 */

import { SUBSTATE_TIMER, SND_IRQ_TRIGGER } from "./ram.js";

/**
 * entry_128b -- game-state-1 sub-state-4, animation-state 0: arm the two-cell
 * blinker and advance the sub-state's own state machine. [ROM 0x128B-0x12AB;
 * arm 0 of entry_127f's rst-0x28 table at 0x1283 (0x639D == 0 -> here, == 1 ->
 * loc_12ac, == 2 -> loc_12de), reached via handler_073c's 0x0748 sub-state table
 * entry 4 while GAME_STATE(0x6005)==1, CREDITS(0x6001)==0, GAME_SUBSTATE(0x600A)==4.]
 *
 * WHAT IT DOES. Gated by the rst-0x18 timer, so it runs only on the tick
 * SUBSTATE_TIMER(0x6009) expires; on every other tick sub_0018 discards the
 * caller's remainder and this returns without touching anything (the SKIP branch).
 * When the timer expires (the PROCEED branch) it:
 *   - Sets the low blinker cell (0x694D) to 0xF8 if its old bit7 was set, else
 *     0x78. The ROM computes this as `ld a,0xF0 / rl (0x694D) / rra / ld (0x694D),a`:
 *     the `rl` shifts old bit7 into carry (and writes a throwaway value that the
 *     final store overwrites), and `rra` folds that carry back into bit7 of 0xF0>>1
 *     = 0x78. So the byte just toggles between 0x78 and 0xF8; reduced to that here.
 *   - inc (0x639D): advances this sub-state's animation state 0 -> 1, so the NEXT
 *     dispatch runs loc_12ac (the blinker animator) instead of re-running this.
 *   - 0x639E := 0x0D: seeds loc_12ac's own down-counter (13 animation ticks).
 *   - SUBSTATE_TIMER(0x6009) := 0x08: re-arm the rst-0x18 gate for 8 ticks.
 *   - call 0x30BD: clear four stride-4 runs in work-RAM pages 0x69/0x6A (blinker
 *     sprite scratch), reached via m.call.
 *   - SND_IRQ_TRIGGER(0x6088) := 3: assert the sound-CPU IRQ line (a 3-frame cue).
 *
 * INPUTS: SUBSTATE_TIMER (via sub_0018) and the old value of (0x694D) (its bit7).
 *   OUTPUTS: (0x694D), (0x639D)+1, (0x639E), SUBSTATE_TIMER, the 0x69/0x6A runs
 *   (via sub_30bd), and SND_IRQ_TRIGGER. NO hardware (0x7Dxx) writes -- every
 *   store lands in work RAM -- so there is no write-bus-cycle to preserve and no
 *   write-trace test is needed (contrast loc_0a8a's palette latches).
 *
 * FLAGS: nothing downstream consumes entry_128b's own flags. On the SKIP branch
 *   the observable end state is sub_0018's (it inc-sp'd and returned to our
 *   caller). On the PROCEED branch the final F is sub_30bd's -- the two post-call
 *   instructions (`ld a,0x03 / ld (0x6088),a`) touch no flag -- so F is correct
 *   automatically because sub_30bd is the shared callee. The body's own flag
 *   writers (the rl/rra, the inc, the loads) are all overwritten before any read,
 *   so they are dropped. A ends 0x03 (set explicitly, as the ROM's `ld a,0x03`);
 *   HL/BC/DE/F all end as sub_30bd leaves them (identical callee), and A going
 *   INTO sub_30bd is dead (sub_30e4's first act is `ld a,l`), so the dropped
 *   `ld a,0x0D`/`ld a,0x08` churn cannot change the callee's result.
 *
 * ATOMIC -- cycles collapsed, TOTAL preserved per branch. entry_128b is dispatched
 *   from INSIDE the vblank NMI (handler_073c, via dispatchGameState), where the NMI
 *   mask is held clear, so the NMI can never land inside it OR its callees. Its
 *   internal cycle DISTRIBUTION is therefore unobservable and the PROCEED body's
 *   per-instruction m.step charges collapse to two: the pre-call block 0x128F-0x12A3
 *   (104t) + the call (17t) = 121t before m.call(0x30BD), and the post-call
 *   `ld a,0x03 / ld (0x6088),a / ret` (7+13+10 = 30t) folded into m.ret(30). The
 *   rst-0x18's own 11t stay charged before m.call(0x0018) per the calling
 *   convention. The TOTAL stays load-bearing -- as part of the NMI's cost it sets
 *   mainLoop's vblank-spin count (SPIN_COUNT, README §2) -- so each branch's sum is
 *   preserved exactly (SKIP 11t of entry_128b's own; PROCEED 11+121+30 = 162t),
 *   which whole-machine EQUAL confirms and the synthesised branch tests pin with an
 *   explicit cycle-total assertion. (Same collapse conclusion as loc_084b, the
 *   sibling 0x0748-table NMI routine.)
 */
export function entry_128b(m) {
  const { regs, mem } = m;

  // rst 0x18 -- tick SUBSTATE_TIMER; run the body only when it EXPIRES. sub_0018
  // dec's the timer and, unless it hit 0, discards our remainder and returns to
  // our caller (m.call returns false). Its 11t is charged before the call.
  m.push16(0x128c);
  m.step(0x0018, 11);
  if (!m.call(0x0018)) return; // timer not expired -> body skipped (SKIP branch)

  // ---- PROCEED body (timer expired) ----

  // ld a,0xF0 / rl (0x694D) / rra / ld (0x694D),a -- toggle the low blinker cell
  // between 0x78 and 0xF8 on its old bit7. The rl's throwaway store is overwritten
  // by the final store, and the intermediate A/flags are dead (see block comment).
  mem.write8(0x694d, (mem.read8(0x694d) & 0x80) ? 0xf8 : 0x78);

  regs.incMem8(mem, 0x639d);         // inc (0x639D) -- advance animation state 0 -> 1
  mem.write8(0x639e, 0x0d);          // 0x639E := 0x0D -- seed loc_12ac's counter (13)
  mem.write8(SUBSTATE_TIMER, 0x08);  // re-arm the rst-0x18 gate: 8 ticks

  // call 0x30BD -- clear four stride-4 runs in work-RAM pages 0x69/0x6A.
  m.push16(0x12a6);
  m.step(0x30bd, 121); // body 0x128F-0x12A3 (104t) + call (17t)
  m.call(0x30bd);

  regs.a = 0x03;
  mem.write8(SND_IRQ_TRIGGER, regs.a); // 0x6088 := 3 -- assert the sound-CPU IRQ (3-frame cue)
  m.ret(30); // ld a,0x03 (7) + ld (0x6088),a (13) + ret (10) = 30t
}

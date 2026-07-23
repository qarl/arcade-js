// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0bb3 — hand-optimized rewrite of the translated routine at ROM 0x0BB3,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0018, the `rst 0x18` countdown gate) is
 * reached through `m.call`, the routine registry (games/dkong/routines.js), so it
 * resolves to the oracle — or to a future optimized rewrite — never a copy. Only
 * RAM *names* are imported (ram.js); 0x6919 is unnamed and kept hex.
 */

import {
  SUBSTATE_TIMER, // 0x6009 -- low/fast half of the sub-state countdown
  GAME_SUBSTATE, // 0x600A -- the outer selector this routine advances
  INTRO_STEP, // 0x6385 -- the sequence index this routine wraps to 0
  SND_PRIORITY, // 0x608A
  SND_PRIORITY_FRAMES, // 0x608B
} from "./ram.js";

/**
 * loc_0bb3 -- the intro cutscene's TERMINAL step (0x6385 sequence entry 7): a
 * countdown-gated "wrap the sequence and advance the outer selector". [ROM
 * 0x0BB3-0x0BD9; reached via dispatchGameState as entry 7 of loc_0a76's 0x0A7A
 * rst-0x28 table, while GAME_SUBSTATE(0x600A)==7 and INTRO_STEP(0x6385)==7.]
 *
 * WHAT IT DOES. Runs once per NMI frame while parked on sequence step 7, holding
 * the Kong-climb intro on its final pose until the SUBSTATE_TIMER(0x6009) counter
 * expires, then releases the game to the next sub-state.
 *
 *   1. A three-way PROLOGUE keyed on SUBSTATE_TIMER's CURRENT value (before the
 *      gate ticks it):
 *        - == 0x90: prime the roar audio -- SND_PRIORITY(0x608A)<-0x0F,
 *          SND_PRIORITY_FRAMES(0x608B)<-0x03 -- and `inc (0x6919)`.
 *        - == 0x18: `dec (0x6919)`.
 *        - otherwise: nothing.
 *      (0x6919 is an unnamed frame-paced bookkeeping byte nudged at the two fixed
 *      timer marks 0x90 and 0x18 as the counter sweeps down.)
 *   2. `rst 0x18` (sub_0018): decrement SUBSTATE_TIMER. If it did NOT reach zero,
 *      sub_0018 discards THIS routine's return address and returns to our caller's
 *      caller -- so loc_0bb3 does nothing further this frame (early return).
 *   3. Only when the counter EXPIRES: `xor a` then INTRO_STEP(0x6385)<-0 (wrap the
 *      sequence to arm 0), `inc (0x6009)` (sub_0018 left HL==SUBSTATE_TIMER; this
 *      undoes its decrement, re-seeding the timer to 1), then HL++ and
 *      `inc (0x600A)` -- advance GAME_SUBSTATE, ending the cutscene.
 *
 *   Note the timer marks and the gate never coincide: 0x90 and 0x18 both decrement
 *   to non-zero (0x8F / 0x17), so the 0x90 and 0x18 arms ALWAYS take the early
 *   return; the epilogue is reachable ONLY through the "otherwise" arm with the
 *   counter at 1. Four reachable paths total, no more.
 *
 * INPUTS: SUBSTATE_TIMER (read + branch key) and, via sub_0018, its post-decrement
 *   value (the gate). OUTPUTS: on the 0x90 arm SND_PRIORITY/SND_PRIORITY_FRAMES and
 *   0x6919; on the 0x18 arm 0x6919; SUBSTATE_TIMER (decremented by sub_0018, and on
 *   expiry re-incremented); on expiry INTRO_STEP(<-0) and GAME_SUBSTATE(++). A ends
 *   the original timer value on every early-return path, 0 on the expiry path.
 *
 * FLAGS. Nothing downstream consumes loc_0bb3's flags -- its caller is
 *   dispatchGameState's rst-0x28 tail, which makes no `ret cc` and branches on no
 *   flag it sets. But the unit gate compares the whole register file (F included),
 *   so every flag-writer is kept VERBATIM, and the `cp` is load-bearing for a
 *   subtle reason: `cp 0x90`/`cp 0x18` set the CARRY, and sub_0018's only flag op
 *   is `dec (hl)`, which does NOT touch carry -- so on every EARLY-RETURN path the
 *   carry from the last `cp` survives all the way to exit and the unit gate sees
 *   it. (A first draft that branched on a plain JS value comparison instead dropped
 *   that carry and diverged F on the "otherwise" arm: 0x03 vs 0x02.) So the branch
 *   is driven off `regs.cp(...)` exactly like the oracle. sub_0018's `dec (hl)`
 *   supplies S/Z/H/P-V/N at exit on the early-return paths; on the expiry path
 *   `xor a` clears carry and the final `inc (0x600A)` supplies the rest. The
 *   `incMem8`/`decMem8` (0x6919) RMW flag effects are genuinely dead (overwritten
 *   by sub_0018 / the epilogue) but the ops are kept for their memory effect.
 *
 * ATOMIC -- cycles collapsed, TOTAL preserved. loc_0bb3 runs INSIDE the vblank NMI
 *   (dispatchGameState), which does not re-enter, so the NMI never lands inside it
 *   OR sub_0018 (same property proven for loc_0a8a on the identical dispatch path).
 *   So its internal cycle DISTRIBUTION is unobservable and each straight-line run
 *   collapses to ONE m.step charge: prologue 96t (0x90 arm) / 81t (0x18 arm) / 61t
 *   (otherwise), epilogue 45t; the `rst 0x18` charge (11t) and the m.call(0x0018)
 *   scaffolding stay put (calling convention). The TOTAL is still load-bearing --
 *   as part of the NMI's cost it sets the main-loop spin count (README §2) -- so
 *   each branch's sum is preserved exactly and the whole-machine gate (176 natural
 *   dispatches across all four arms) confirms it; the synthesised branch tests pin
 *   each collapsed total independently. No hardware (0x7Dxx) writes -- every store
 *   is work RAM -- so there is no write-bus-cycle trace to preserve.
 */
export function loc_0bb3(m) {
  const { regs, mem } = m;

  // ---- Prologue: branch on the CURRENT timer value (before the gate ticks it) ----
  // The `cp`s are kept verbatim: their carry survives sub_0018 to exit (see FLAGS).
  regs.hl = 0x608a; // = SND_PRIORITY; the 0x90 arm writes through it (else dead)
  regs.a = mem.read8(SUBSTATE_TIMER); // A = 0x6009 (kept: it is A on every early return)
  regs.cp(0x90);

  if (regs.fZ) {
    // 0x90 mark: prime roar audio, bump 0x6919. path 30+7+10+6+10+10+11+12 = 96t.
    mem.write8(SND_PRIORITY, 0x0f); // 0x608A
    mem.write8(SND_PRIORITY_FRAMES, 0x03); // 0x608B
    regs.hl = 0x6919;
    regs.incMem8(mem, regs.hl); // inc (0x6919)
    m.step(0x0bd1, 96);
  } else {
    regs.cp(0x18);
    if (regs.fZ) {
      // 0x18 mark: nudge 0x6919 down. path 30+12+7+7+10+11+4 = 81t.
      regs.hl = 0x6919;
      regs.decMem8(mem, regs.hl); // dec (0x6919)
      m.step(0x0bd1, 81);
    } else {
      // otherwise: straight to the gate. path 30+12+7+12 = 61t. HL stays 0x608A (dead).
      m.step(0x0bd1, 61);
    }
  }

  // ---- loc_0bd1: the rst 0x18 countdown gate ----
  // sub_0018 decrements SUBSTATE_TIMER and, if it did NOT reach zero, discards this
  // routine's return address and returns to our caller's caller -> we stop here.
  m.push16(0x0bd2); // rst 0x18 pushes its return address (balances sub_0018's ret)
  m.step(0x0018, 11); // rst 0x18 (11t); pc -> 0x0018
  if (!m.call(0x0018)) return; // counter not expired -- skipped past our caller

  // ---- Epilogue (counter expired only): wrap the sequence, advance the selector ----
  // sub_0018 left HL == SUBSTATE_TIMER (0x6009). Atomic + no hardware writes, so the
  // five instructions collapse to one 45t charge (4+13+11+6+11).
  regs.xor(regs.a); // xor a -- A = 0
  mem.write8(INTRO_STEP, regs.a); // 0x6385 <- 0: wrap the sequence to arm 0
  regs.incMem8(mem, regs.hl); // inc (0x6009): undo sub_0018's dec (HL == SUBSTATE_TIMER)
  regs.hl = (regs.hl + 1) & 0xffff; // HL = 0x600A (GAME_SUBSTATE)
  regs.incMem8(mem, regs.hl); // inc (0x600A): advance the outer selector; sets final F
  m.step(0x0bd9, 45);
  m.ret(); // ret (0x0BD9) -- 10t; pops loc_0bb3's return address
}

// SPDX-License-Identifier: GPL-3.0-only
/**
 * handler_1977 — hand-optimized rewrite of the translated routine at ROM 0x1977,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Both callees (0x21ee and 0x197a) are reached through
 * `m.call`, the routine registry (games/dkong/routines.js), so each resolves to
 * the oracle or to a future optimized rewrite. Nothing is imported from
 * translated/; this trampoline names no RAM, so ram.js is not imported either.
 */

/**
 * handler_1977 -- game-state-1 sub-state index 3: tick the demo/animation script,
 * then run the shared per-frame engine cascade.  [ROM 0x1977-0x1979, then FALLS
 * THROUGH into loc_197a @ 0x197A]
 *
 *   1977  cd ee 21   call 0x21ee   ; sub_21ee -- PLAIN call, returns to 0x197A
 *   197a  ...        (falls straight through into loc_197a, a separate routine)
 *
 * DISPATCH. Reached from the 0x0748 inline jump table (handler_073c, game state 1)
 * at index 3, i.e. when GAME_STATE(0x6005)==1, CREDITS(0x6001)==0 and
 * GAME_SUBSTATE(0x600A)==3. It runs inside the vblank NMI. This is "THE FINALE
 * reach-mover": wiring it live runs the whole engine cascade -- the spine
 * (entry_1ac3, sub_1f72, entry_30ed, ...) plus ~25 per-frame updaters -- via
 * loc_197a.
 *
 * WHAT IT DOES (plain English). Two acts, no logic of its own:
 *   1. `call sub_21ee` -- the demo/animation SCRIPT tick. sub_21ee decodes the
 *      next scripted-input byte into 0x6010, counts down the per-step timer at
 *      0x63CD and advances the script index at 0x63CC. This is handler_1977's
 *      ONLY distinctive work; loc_197a's own task entry (dw 0x197a @0x071A) runs
 *      the identical cascade WITHOUT this tick.
 *   2. Fall through into loc_197a -- the shared per-frame update cascade.
 *
 * INPUTS. None read directly (this routine touches no RAM itself). Its observable
 * effect is entirely the union of sub_21ee's and loc_197a's reads/writes, reached
 * by address so they stay the oracle (or a proven rewrite).
 * OUTPUTS. None written directly; see the callees.
 *
 * CALLING CONVENTION. `call sub_21ee` PUSHES the return address 0x197A, which
 * sub_21ee's own `ret` pops -- modeled as `m.push16(0x197a)` before `m.call`.
 * The fall-through into loc_197a is NOT a call: it is the physical next
 * instruction, so it is a TAIL call sharing this routine's stack frame -- no
 * push16 precedes it, and loc_197a's terminal `ret` pops the return address the
 * DISPATCHER pushed for handler_1977. Hence `return m.call(0x197a)`.
 *
 * RETURN / FLAGS. Returns loc_197a's return value verbatim. loc_197a signals its
 * "hidden exit" (sub_1e57's pop-hl unwind) by returning early; the value is
 * currently IGNORED by the 0x0748 sub-state dispatch caller (sub_0028's note), so
 * it is inert today, but it is propagated exactly so the contract holds if a
 * future caller consumes it. handler_1977 sets no flags of its own.
 *
 * CYCLES / ATOMICITY. handler_1977 is NOT atomic: it tail-calls loc_197a, the
 * deeply INTERRUPTIBLE engine cascade, so the vblank NMI's timing reaches its
 * callees. But its OWN footprint is a single instruction -- the 17-T `call 0x21ee`
 * at 0x1977 -- so there is no per-instruction distribution to collapse; the 17 T
 * is preserved verbatim (identical to the oracle). The NMI's TOTAL cost sets the
 * main-loop vblank spin count / PRNG (README §2), so that 17 T is load-bearing: a
 * wrong own-charge (16 instead of 17) shifts a later frame's NMI landing and is
 * CAUGHT by the whole-machine gate (see the cycle-teeth test). Every downstream
 * cycle stays with the callees, per-instruction, untouched here.
 *
 * LADDER STATUS -- rung 4 (idiomatic): a two-act trampoline. There are no RAM
 * names to introduce, no dead register churn to drop, no data-dependent branch,
 * and a single own cycle charge -- so the idiomatic form is structurally the
 * oracle's, and the deliverable is the documented, gate-proven equivalent.
 */
export function handler_1977(m) {
  // 1. call sub_21ee (0x1977, 17 T) -- the demo/animation script tick.
  //    Plain call: sub_21ee's `ret` pops this pushed 0x197A and returns here.
  m.push16(0x197a);
  m.step(0x21ee, 17);
  m.call(0x21ee);

  // 2. Fall through into loc_197a (0x197A) -- the shared per-frame cascade.
  //    Tail call: no push16 (physical fall-through); loc_197a's `ret` pops the
  //    address the dispatcher pushed for us. Its return value is propagated.
  return m.call(0x197a);
}

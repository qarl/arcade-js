// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0c91 — hand-optimized rewrite of the translated routine at ROM 0x0C91,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. BOTH its callees — 0x0018 (the rst 0x18 countdown-skip
 * helper) and 0x0C92 (the board-setup body it falls through into) — are reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle or to a future optimized rewrite, never a copy. This
 * file imports no RAM names: loc_0c91 references no work-RAM address of its own
 * (the only byte in play, SUBSTATE_TIMER 0x6009, is read+decremented INSIDE
 * sub_0018, not here), so there is nothing to name.
 */

// loc_0c91 is one byte of ROM: `df` = rst 0x18. These two ROM CODE addresses are
// the whole routine — not RAM, so they stay as bare code-address constants.
const RST18 = 0x0018; // sub_0018: single-level countdown-skip on SUBSTATE_TIMER (0x6009)
const FALLTHROUGH = 0x0c92; // loc_0c92 (board setup); it is BOTH the rst's return address
//                             AND the fall-through target sub_0018's `ret z` lands on.

/**
 * loc_0c91 -- board-setup timing gate: run loc_0c92 only when SUBSTATE_TIMER
 * expires, else skip this frame. [ROM 0x0C91, the 0x0702 table's index-10 target,
 * dispatched via dispatchGameState while GAME_STATE(0x6005)==3 and
 * GAME_SUBSTATE(0x600A)==10.]
 *
 *   0c91  df           rst  0x18        ; skip loc_0c92 unless 0x6009 expires
 *   0c92  ...          (falls through into the existing loc_0c92 body)
 *
 * WHAT IT DOES. A pure DISPATCH GATE, and a SECOND, gated entry point into the
 * loc_0c92 body (which is also reached by an ungated tail-jump from handler_0763
 * at 0x0776). `rst 0x18` runs sub_0018, the single-level prescaler that
 * decrements SUBSTATE_TIMER (0x6009) once per frame:
 *   - COUNTER STILL TICKING (dec -> non-zero): sub_0018 discards this routine's
 *     return address (the two `inc sp`) and returns to loc_0c91's CALLER'S caller
 *     -- the "skip". loc_0c92 does NOT run this frame; nothing but 0x6009 changed.
 *     Modelled by `m.call(RST18)` returning false, forwarded as an early return
 *     (the rst skip-idiom, same convention as loc_084b / handler_0763).
 *   - COUNTER EXPIRED (dec -> zero): sub_0018's `ret z` lands PC at 0x0C92, so
 *     control FALLS THROUGH into loc_0c92, which builds the board (palette bank,
 *     a task enqueue, then a `dec a` cascade on BOARD (0x6227) into the per-board
 *     setup). Modelled by `m.call(FALLTHROUGH)` returning true; loc_0c92's own
 *     `ret` returns for us. This is a fall-through, not a real call, so it carries
 *     NO extra cycle charge (there is no instruction between the two).
 *
 * INPUTS (read):  SUBSTATE_TIMER (0x6009) -- read+decremented inside sub_0018,
 *                 not here; and the return address on the stack (unwound by the rst
 *                 skip idiom). On the expire branch loc_0c92 reads BOARD (0x6227).
 * OUTPUTS (write): NONE of loc_0c91's own. On skip, sub_0018 writes SUBSTATE_TIMER.
 *                 On expire, loc_0c92 writes the palette-bank latches (0x7D86/0x7D87),
 *                 work/video RAM, and re-arms SUBSTATE_TIMER. All via `m.call`, so
 *                 identical to the oracle byte-for-byte and cycle-for-cycle.
 *
 * FLAGS / REGISTERS. loc_0c91 executes only `rst 0x18` and touches NEITHER a flag
 * nor a register of its own; F and every register are exactly whatever sub_0018
 * (skip: Z set from the non-zero `dec`) or loc_0c92 (expire) leaves. This rewrite
 * likewise writes no flag/register, so the unit gate's full register-file+F+pc
 * compare matches the oracle bit-for-bit. The JS return value is preserved too
 * (undefined on skip, loc_0c92's boolean on expire) so the skip-capable-dispatch
 * convention sub_0028 relies on is intact -- inert today, load-bearing if a
 * skip-capable target is ever dispatched through here.
 *
 * ATOMIC / CYCLES -- NOTHING TO COLLAPSE. loc_0c91 is dispatched from INSIDE the
 * vblank NMI (dispatchGameState), where the NMI mask is held, so the NMI can never
 * land inside it: it is ATOMIC. But the collapse rule (README §2) is MOOT here --
 * loc_0c91 executes exactly ONE instruction of its own, the `rst 0x18` (11 t), so
 * there is only a single cycle charge and no per-instruction distribution to fold.
 * All remaining cycles live inside the callees (sub_0018, loc_0c92), which stay
 * per-instruction as their own oracles and are reached via `m.call`. The single
 * rst charge is kept verbatim (11 t) -- and it is still load-bearing: as part of
 * the NMI's cumulative cost it feeds mainLoop's vblank-spin count (the PRNG
 * entropy), so a wrong rst charge would diverge at SPIN_COUNT (0x6019); the
 * per-branch cycle-total tests pin it.
 *
 * The push16(FALLTHROUGH) + m.step(RST18, 11) pair is the calling convention (the
 * rst's own push, balanced by sub_0018's stack unwind), NOT scaffolding to drop.
 */
export function loc_0c91(m) {
  // rst 0x18 -- push the fall-through address (0x0C92), charge the rst, run the
  // single-level countdown-skip helper. The boolean is the rst skip-idiom.
  m.push16(FALLTHROUGH); // rst 0x18 pushes its return address = 0x0C92
  m.step(RST18, 11); // rst 0x18 (the only instruction loc_0c91 executes; 11 t)
  if (!m.call(RST18)) return; // SUBSTATE_TIMER still ticking -- skip; loc_0c92 does not run

  // SUBSTATE_TIMER expired -- fall through into loc_0c92 (board setup). PC is
  // already 0x0C92 (sub_0018's `ret z`), a zero-cycle fall-through; loc_0c92's own
  // `ret` returns for us. Forward its boolean (skip-capable-dispatch convention).
  return m.call(FALLTHROUGH);
}

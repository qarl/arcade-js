// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_127c — hand-optimized rewrite of the translated routine at ROM 0x127C,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its two callees (0x1DBD and 0x127F) are reached through
 * `m.call`, the routine registry (games/dkong/routines.js), so each resolves to
 * the oracle — or to a future optimized rewrite — and is never imported or copied
 * here. loc_127c reads and writes NO work RAM of its own, so it imports no RAM
 * names: it is a pure dispatch sequencer whose every memory effect lives in the
 * callees it invokes.
 */

/**
 * loc_127c -- game-state-1 sub-state 4: run engine-state router, then the 0x639D
 * timed sub-state machine.  [ROM 0x127C-0x127E, then falls through into entry_127f]
 *
 *   127c  cd bd 1d     call 0x1dbd      ; sub_1dbd: rst-0x28 router on (0x6340)
 *   (falls through into entry_127f @ 0x127F)
 *   127f  3a 9d 63     ld   a,(0x639d)  ; entry_127f: rst-0x28 router on (0x639D)
 *   1282  ef           rst  0x28        ; table 0x1283: 128B 12AC 12DE 0000
 *
 * A two-step DISPATCH SEQUENCER, dispatched from inside the NMI as entry 4 of
 * handler_073c's 0x0748 sub-state table (selected when GAME_SUBSTATE 0x600A == 4).
 * loc_127c's OWN contribution is exactly one instruction -- the `call 0x1dbd` --
 * plus the fall-through; it has no branch, no register work, and no store of its
 * own. It does two things in order:
 *
 *   1. call 0x1dbd (sub_1dbd) -- a rst-0x28 router on engine-state (0x6340) that
 *      advances a tiny sub-machine (arm 0 is a bare `ret`; arm 1 advances the
 *      state; arm 2 is a finale-latent countdown). sub_1dbd writes nothing itself.
 *   2. fall through into entry_127f @ 0x127F -- a rst-0x28 router on (0x639D) that
 *      runs ONE of three timed sub-state handlers (entry_128b / loc_12ac / loc_12de),
 *      each gated by the rst-0x18 counter (0x6009). Those handlers own every RAM
 *      effect on the path: the two-cell blinker 0x694D/0x694E, the sub-state
 *      advance 0x639D, its inner countdown 0x639E, the 0x6009 re-arm, 0x6088, 0x600A.
 *
 * Both callees are invoked via m.call, so they resolve to the oracle (or a future
 * optimized rewrite). entry_127f is reached by ADDRESS (0x127F, the fall-through
 * target), exactly as the ROM falls out of the 3-byte `call` into the next opcode.
 *
 * INPUTS (via the callees, not loc_127c itself): engine-state (0x6340), sub-state
 * selector (0x639D), the rst-0x18 gate counter (0x6009), player index (0x600E).
 * OUTPUTS: none of loc_127c's own; the callees write the addresses listed above.
 *
 * FLAGS / RETURN. loc_127c has no `ret cc` of its own and touches no register or
 * flag directly -- it returns entry_127f's result UNCHANGED (`return m.call(0x127f)`),
 * which is the rst-0x28 arm's own return, and leaves A/F and the whole register
 * file exactly as the callees do. So every register (F included) and pc match the
 * oracle BY CONSTRUCTION; the unit gate compares the full register file + pc and
 * confirms it. Nothing to keep here because nothing here is computed here.
 *
 * LADDER STATUS -- rung 4 (idiomatic), cycles NOT collapsed because there is
 * nothing to collapse: loc_127c has exactly ONE instruction of its own (the
 * `call 0x1dbd`, 17 t) and exactly one path (no data-dependent branch), so its
 * single m.step charge already IS the branch total. It is kept verbatim. The
 * total is still LOAD-BEARING: loc_127c runs inside the NMI, whose cumulative
 * cycles feed mainLoop's vblank-spin count (the PRNG entropy, README §2) and set
 * where a downstream NMI lands on the stack. Dropping the 17 t diverges at stack
 * 0x6BF6 (frame 102, 25 vs 131) -- the same downstream-NMI-push mechanism as
 * entry_0611: this NMI's total cost shifts where a LATER frame's NMI lands in the
 * diffed stack. Preserve the charge; do not drop. Nothing here is NMI-interruptible
 * (dispatched from inside the NMI with the mask held, so no vblank NMI lands inside
 * loc_127c or its callees); with one own instruction the atomic/collapse distinction
 * is moot, and the callees stay per-instruction as the frozen oracle routines they are.
 */
export function loc_127c(m) {
  // 127c  call 0x1dbd -- push the fall-through address (0x127F), charge the CALL's
  // 17 t (kept: the NMI's total is observable via the spin count and a downstream
  // stack push), then run sub_1dbd via the registry (oracle or future rewrite).
  m.push16(0x127f);
  m.step(0x1dbd, 17);
  m.call(0x1dbd);

  // Fall through into entry_127f at 0x127F -- exactly as the ROM drops out of the
  // 3-byte `call` into the next opcode. Its rst-0x28 dispatch tail returns for us,
  // so hand its result straight back to loc_127c's caller.
  return m.call(0x127f);
}

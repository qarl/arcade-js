// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_04f1 — hand-optimized rewrite of the translated routine at ROM 0x04F1,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Both callees (0x0514 the colour fill, 0x04f9 the blink-OFF
 * tail it falls into) are reached through `m.call(0xADDR)`, which resolves via the
 * routine registry (games/dkong/routines.js) to the oracle — or to that callee's
 * own optimized rewrite once one exists — so there is never a copied implementation
 * here to drift. This routine touches no work-RAM address of its own, so it imports
 * no name from ram.js.
 */

/**
 * loc_04f1 -- colour write then fall into loc_04f9 (blink OFF). [ROM 0x04F1-0x04F8]
 *
 *   04f1  3e ef        ld   a,0xef          ; colour-fill seed
 *   04f3  21 83 75     ld   hl,0x7583       ; colour RAM column
 *   04f6  cd 14 05     call 0x0514          ; descending 3-cell fill (stride DE=0x20)
 *   (falls through into loc_04f9 @ 0x04F9 -- clears the blink bit7 of 0x6901/0x6905)
 *
 * WHAT IT DOES. loc_04be's branch B tail — the (0x6227)==4 blink block routes here
 * when the frame counter's bit 6 is set AND Mario is on the right half of the screen
 * (MARIO_X >= 0x80). It re-lays ONE colour-RAM column: sub_0514 does a descending
 * 3-cell fill from HL=0x7583, stride DE=0x0020 (both supplied — DE by loc_0486's
 * `ld de,0x0020`, still live in this register on entry), seed A=0xef. So it writes
 * 0x7583=0xef, 0x75a3=0xee, 0x75c3=0xed (A decrements per cell, leaving A=0xec).
 * Then control falls straight into loc_04f9, which clears bit 7 of 0x6901 and 0x6905
 * (blink OFF) and jp's back to loc_04ac.
 *
 * INPUTS.  DE = 0x0020 (fill stride, LIVE-IN from loc_0486, consumed by sub_0514).
 * No RAM read of its own; A and HL are loaded from immediates.
 * OUTPUTS. Colour RAM 0x7583/0x75a3/0x75c3 (written by sub_0514); the blink bit 7
 * of 0x6901/0x6905 CLEARED by the loc_04f9 fall-through. A ends 0xec (sub_0514's
 * `dec a` ran 3×). F is the callee chain's result (see FLAGS).
 *
 * IDIOM — THE FALL-THROUGH IS THE CALL'S RETURN ADDRESS. `call 0x0514` pushes its
 * own return address 0x04f9, which is the very next byte AND the entry of the tail
 * routine loc_04f9. So there is no separate `jp` to model: when sub_0514 rets, PC is
 * 0x04f9 and execution simply continues into loc_04f9. The rewrite keeps the
 * `m.push16(0x04f9)` (it balances sub_0514's `ret`) and expresses the continuation
 * as `return m.call(0x04f9)` with NO extra push16 and NO extra m.step — exactly the
 * oracle's model, because 0x04f9 is not a jump target, it is the next instruction.
 *
 * ATOMIC? NO — stays PER-INSTRUCTION (no cycle collapse). ATOMICITY IS PER-CALL-PATH:
 * loc_04f1's ONLY caller is loc_04be (state0.js `jp nc,0x04f1`), reached via
 * loc_0486 <- entry_03fb <- loc_197a — the INTERRUPTIBLE per-frame in-game colour
 * cascade with the vblank NMI mask ENABLED. The NMI can land inside this routine
 * (and inside the interruptible sub-tree it falls into via sub_0514 / loc_04f9 /
 * loc_04ac), so its internal cycle distribution is observable and a collapse is NOT
 * permitted. Every oracle m.step charge is retained verbatim — same decision as the
 * sibling loc_04be / loc_04e1 / loc_04ac and their common ancestor loc_197a.
 * (Harness-checked: the whole-machine gate stays EQUAL over 1300 frames — override
 * firing 261× from frame 1041 — with the per-instruction charges kept.)
 *
 * FLAGS. Kept verbatim. loc_04f1's own two instructions (`ld a`, `ld hl`) set NO
 * flags, so F entering sub_0514 is untouched; F on exit is produced by the identical
 * callee chain (sub_0514's `add hl,de`/`dec a`, then loc_04f9/loc_04ac) reached
 * through the same m.call, so the unit gate's whole-register-file compare (F
 * included) matches by construction.
 *
 * LADDER STATUS — rung 2/3 (named + structured + documented), NOT de-scaffolded
 * (non-atomic, per above). Behaviourally byte-identical to ../translated/state0.js.
 */
export function loc_04f1(m) {
  const { regs } = m;

  // Seed + target for the descending 3-cell colour fill (stride DE=0x0020 is live-in
  // from loc_0486). Neither load affects flags.
  regs.a = 0xef;                                        // ld a,0xef
  m.step(0x04f3, 7);
  regs.hl = 0x7583;                                     // ld hl,0x7583 (colour RAM)
  m.step(0x04f6, 10);

  // call sub_0514 -> fills 0x7583/0x75a3/0x75c3 with 0xef/0xee/0xed, then RETS to
  // 0x04f9 (the pushed return address), which IS the next routine loc_04f9.
  m.push16(0x04f9); m.step(0x0514, 17); m.call(0x0514);

  // Fall through into loc_04f9 (blink OFF: clear bit7 of 0x6901/0x6905, jp 0x04ac).
  return m.call(0x04f9);
}

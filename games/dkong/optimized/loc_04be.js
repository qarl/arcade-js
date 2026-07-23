// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_04be — hand-optimized rewrite of the translated routine at ROM 0x04BE,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0514, 0x0509, 0x04f1, 0x04e1) is reached
 * through `m.call(0xADDR)`, which resolves via the routine registry
 * (games/dkong/routines.js) to the oracle — or to that callee's own optimized
 * rewrite once one exists — so there is never a copied implementation here to
 * drift. Only the RAM *name* MARIO_X is imported (from ram.js).
 */

import { MARIO_X } from "./ram.js";

/**
 * loc_04be -- (0x6227)==4 blink block for the colour-cycle driver. [ROM 0x04BE-0x04E0]
 *
 *   04be  3e 10        ld   a,0x10          ; colour-fill seed
 *   04c0  21 23 76     ld   hl,0x7623       ; colour RAM column
 *   04c3  cd 14 05     call 0x0514          ; descending 3-cell fill (stride DE=0x20)
 *   04c6  21 83 75     ld   hl,0x7583       ; second colour RAM column (A carries, =0x0d)
 *   04c9  cd 14 05     call 0x0514          ; descending 3-cell fill
 *   04cc  cb 71        bit  6,c             ; C = loc_0486's frame counter (0x6390)
 *   04ce  ca 09 05     jp   z,0x0509        ; bit6 clear -> loc_0509 (X-routing variant)
 *   04d1  3a 03 62     ld   a,(0x6203)      ; A = MARIO_X
 *   04d4  fe 80        cp   0x80
 *   04d6  d2 f1 04     jp   nc,0x04f1       ; X >= 0x80 -> loc_04f1 (blink OFF)
 *   04d9  3e df        ld   a,0xdf          ; X <  0x80 -> third colour fill ...
 *   04db  21 23 76     ld   hl,0x7623
 *   04de  cd 14 05     call 0x0514          ; ... then fall into loc_04e1 (blink ON)
 *
 * WHAT IT DOES. The (0x6227)==4 arm of the intro/colour-cycle tail loc_0486. It
 * unconditionally re-lays two colour-RAM columns (each a descending 3-cell fill
 * via sub_0514, stride 0x20 supplied by loc_0486's DE=0x0020), then routes the
 * per-frame blink three ways:
 *   - bit 6 of the frame counter C (loc_0486 loaded C from 0x6390) CLEAR
 *     -> loc_0509, which re-does the same MARIO_X half-screen routing into the
 *        blink ON/OFF setters;
 *   - bit 6 SET and MARIO_X (0x6203) >= 0x80 -> loc_04f1 (blink OFF: clears bit7
 *     of 0x6901/0x6905);
 *   - bit 6 SET and MARIO_X < 0x80 -> a third fill (A=0xdf into 0x7623) then
 *     loc_04e1 (blink ON: sets bit7 of 0x6901/0x6905).
 * So the routine drives a colour blink whose phase follows the frame counter and
 * whose polarity follows which half of the screen Mario is on.
 *
 * INPUTS.  C (frame counter, from loc_0486's `ld c,(0x6390)`); DE=0x0020 (fill
 * stride, live-in to sub_0514); MARIO_X (0x6203). OUTPUTS. Colour RAM 0x7623/
 * 0x7643/0x7663 and 0x7583/0x75a3/0x75c3 (two fills; a third to 0x7623… on the
 * blink-ON arm) written by sub_0514; the blink bit7 of 0x6901/0x6905 is set/
 * cleared by the tail routines it jumps to. A ends decremented by sub_0514; F is
 * the guard flag on each exit (see FLAGS).
 *
 * IDIOM — A CARRIES ACROSS THE TWO FILLS. `ld a,0x10` runs ONCE; sub_0514 leaves
 * A decremented by 3 (0x10 -> 0x0d), and the ROM does NOT reload it before the
 * second `call 0x0514`, so the second column is filled from 0x0d down. The
 * rewrite must not re-seed A between the two calls — sub_0514 mutates the shared
 * regs.a through m.call, exactly as the oracle relies on.
 *
 * ATOMIC? NO — stays PER-INSTRUCTION (no cycle collapse). ATOMICITY IS PER-CALL-
 * PATH: loc_04be's ONLY caller is loc_0486 (state0.js `jp z,0x04be`), reached via
 * loc_197a -> entry_03fb -> the loc_0413 colour tree -> loc_0486 — the INTERRUPTIBLE
 * per-frame in-game cascade with the vblank NMI mask ENABLED. The NMI can land
 * inside this routine (and inside the interruptible sub-tree it tail-calls), so
 * its internal cycle distribution is observable; a collapse is NOT permitted. Every
 * oracle m.step charge is retained verbatim — same decision as loc_197a / entry_03fb
 * / handler_01c3. (Harness-checked: the whole-machine gate stays EQUAL with the
 * per-instruction charges kept.)
 *
 * FLAGS. Kept verbatim on every exit, because the unit gate compares the whole
 * register file (F included) at the tail-call boundary:
 *   - branch A (jp z taken): F is `bit 6,c`'s result — carried into loc_0509.
 *   - branch B (jp nc taken): F is `cp 0x80`'s result — carried into loc_04f1.
 *   - branch C (fall-through): F is set by the final sub_0514 (its `dec a`/`add
 *     hl,de`) — carried into loc_04e1; produced identically by calling the same
 *     m.call(0x0514).
 * A is left decremented by sub_0514 and read by nothing before its next writer, but
 * kept exact for the register diff regardless.
 *
 * LADDER STATUS — rung 2/3 (named + structured + documented), NOT de-scaffolded
 * (non-atomic, per above). Behaviourally byte-identical to ../translated/state0.js.
 */
export function loc_04be(m) {
  const { regs, mem } = m;

  // Two colour-column fills via sub_0514 (descending 3-cell, stride 0x20 from
  // loc_0486's DE). A is seeded ONCE and CARRIES across both calls — sub_0514
  // leaves it decremented by 3 and the ROM never reloads it between the two.
  regs.a = 0x10;                                        // ld a,0x10
  m.step(0x04c0, 7);
  regs.hl = 0x7623;                                     // ld hl,0x7623 (colour RAM)
  m.step(0x04c3, 10);
  m.push16(0x04c6); m.step(0x0514, 17); m.call(0x0514); // call sub_0514
  regs.hl = 0x7583;                                     // ld hl,0x7583 (A carries, =0x0d)
  m.step(0x04c9, 10);
  m.push16(0x04cc); m.step(0x0514, 17); m.call(0x0514); // call sub_0514

  // bit 6,c -- C is loc_0486's frame counter (0x6390); Z means bit 6 is clear.
  regs.bit(6, regs.c);
  m.step(0x04ce, 8);
  if (regs.fZ) {                                        // jp z,0x0509 (bit6-clear arm)
    m.step(0x0509, 10);
    return m.call(0x0509);
  }
  m.step(0x04d1, 10); // jp z NOT taken

  // Route the blink on which half of the screen Mario is on.
  regs.a = mem.read8(MARIO_X);                          // ld a,(0x6203)
  m.step(0x04d4, 13);
  regs.cp(0x80);                                        // cp 0x80
  m.step(0x04d6, 7);
  if (regs.fNC) {                                       // jp nc,0x04f1 -- X >= 0x80 -> blink OFF
    m.step(0x04f1, 10);
    return m.call(0x04f1);
  }
  m.step(0x04d9, 10); // X < 0x80 -> blink ON

  // Third colour fill (A=0xdf into 0x7623), then fall into loc_04e1 (set blink bit7).
  regs.a = 0xdf;                                        // ld a,0xdf
  m.step(0x04db, 7);
  regs.hl = 0x7623;                                     // ld hl,0x7623
  m.step(0x04de, 10);
  m.push16(0x04e1); m.step(0x0514, 17); m.call(0x0514); // call sub_0514 -> falls into 0x04e1
  return m.call(0x04e1);
}

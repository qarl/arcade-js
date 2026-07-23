// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_04e1 — hand-optimized rewrite of the translated routine at ROM 0x04E1,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x04ac) is reached through `m.call(0x04ac)`,
 * which resolves via the routine registry (games/dkong/routines.js) to the oracle —
 * or to that callee's own optimized rewrite once one exists (loc_04ac.js already is
 * one) — so there is never a copied implementation here to drift. It uses no named
 * RAM field (its two addresses, 0x6901/0x6905, are bytes inside SPRITE_BUFFER, not
 * named fields — see below), so it imports nothing at all, exactly like loc_04ac.
 */

/**
 * loc_04e1 -- blink ON: set bit7 of the two colour-cycle sprite-code bytes. [ROM 0x04E1-0x04F0]
 *
 *   04e1  3a 01 69   ld  a,(0x6901)   ; A = sprite-record-0 code byte        13t
 *   04e4  f6 80      or  0x80         ; set bit7 (the blink/highlight bit)     7t
 *   04e6  32 01 69   ld  (0x6901),a   ; store it back                        13t
 *   04e9  3a 05 69   ld  a,(0x6905)   ; A = sprite-record-1 code byte        13t
 *   04ec  f6 80      or  0x80         ; set bit7 (NOT stored here)             7t
 *   04ee  c3 ac 04   jp  0x04ac       ; -> loc_04ac stores A into 0x6905     10t
 *
 * WHAT IT DOES. The blink-ON leaf of the (0x6227)==4 arm of the intro colour-cycle
 * driver (entry_03fb -> ... -> loc_04be / loc_0509). It ORs bit 7 into BOTH colour-
 * cycle bytes 0x6901 and 0x6905, turning the "blink" highlight ON. The 0x6901 write
 * is done here; the 0x6905 value is left in A and PUBLISHED by loc_04ac, the SHARED
 * store this routine tail-jumps into (loc_04ac then runs its own 3-way blink-phase
 * logic on C, the frame counter loc_0486 loaded from 0x6390). This is the mirror of
 * loc_04f9 (blink OFF: `and 0x7f` clears the same two bits).
 *
 * STRAIGHT-LINE. No data-dependent branch of its own: it always runs the same six
 * instructions, then jumps (not calls — no push16) into loc_04ac, whose eventual
 * `ret` returns to loc_04e1's caller. One path, so full branch coverage is the one
 * path plus loc_04ac's three exits (covered by loc_04ac's own tests; exercised end-
 * to-end through m.call here).
 *
 * INPUTS.  RAM 0x6901, 0x6905 (the current low-7-bit sprite codes); C = the attract
 *          frame counter (0x6390), live-in and consumed by loc_04ac downstream.
 * OUTPUTS. RAM 0x6901 |= 0x80 (written here). A = (0x6905)|0x80, published to RAM
 *          0x6905 by loc_04ac (and possibly re-flipped by its blink-phase xor).
 *          F = the second `or 0x80`'s result (see FLAGS).
 * 0x6901/0x6905 are bytes inside SPRITE_BUFFER (0x6900) but are not named fields in
 * their own right, so -- like loc_04ac's 0x6905 and handler_05c6's 0x60B4/B7/BA --
 * they stay hex here.
 *
 * ATOMIC? NO — stays PER-INSTRUCTION (no cycle collapse). ATOMICITY IS PER-CALL-
 * PATH: loc_04e1 is a leaf reached via m.call from exactly two sites — loc_04be
 * (X<0x80 fall-through) and loc_0509 (bit6-clear + X<0x80 `jp 0x04e1`). BOTH sit
 * under loc_197a's per-frame in-game cascade (loc_197a -> entry_03fb -> the loc_0413
 * colour tree -> loc_0486 -> loc_04be/loc_0509 -> here) — the INTERRUPTIBLE path with
 * the vblank NMI mask ENABLED. The NMI can land inside this routine (and inside the
 * interruptible loc_04ac it tail-jumps into), so its internal cycle DISTRIBUTION is
 * observable and a collapse is NOT permitted. Every oracle m.step charge is retained
 * verbatim — same decision, and same reason, as its siblings loc_04ac / loc_04be and
 * their parents entry_03fb / loc_197a. (Harness-checked: the whole-machine gate stays
 * EQUAL with the per-instruction charges kept.)
 *
 * FLAGS. Both `or 0x80`s are kept verbatim, not just because A is load-bearing (the
 * first feeds the 0x6901 store, the second is loc_04ac's colour byte), but because F
 * is observable: the routine is interruptible, so if the vblank NMI lands after the
 * second `or 0x80` (before loc_04ac's `bit 6,c` overwrites F) it pushes AF onto the
 * stack, which is diffed work RAM. regs.or reproduces the Z80 flag semantics exactly
 * (S/Z/PV from the result, H=0, N=0, C=0), so F matches the oracle by construction.
 *
 * LADDER STATUS — rung 2/3 (named + structured + documented), NOT de-scaffolded
 * (non-atomic, per above). Behaviourally byte-identical to ../translated/state0.js.
 */
export function loc_04e1(m) {
  const { regs, mem } = m;

  // Set bit7 of the first colour-cycle byte (0x6901) and store it back.
  regs.a = mem.read8(0x6901); // ld a,(0x6901) -- inside SPRITE_BUFFER, stays hex
  m.step(0x04e4, 13);
  regs.or(0x80); // or 0x80 -- turn the blink/highlight bit ON
  m.step(0x04e6, 7);
  mem.write8(0x6901, regs.a); // ld (0x6901),a
  m.step(0x04e9, 13);

  // Set bit7 of the second colour-cycle byte (0x6905) in A; loc_04ac stores it.
  regs.a = mem.read8(0x6905); // ld a,(0x6905) -- inside SPRITE_BUFFER, stays hex
  m.step(0x04ec, 13);
  regs.or(0x80); // or 0x80 -- blink bit ON; NOT written here (loc_04ac publishes A)
  m.step(0x04ee, 7);

  // jp 0x04ac -- tail-jump (no push16) into the SHARED store; its ret returns to
  // loc_04e1's caller. loc_04ac writes A -> 0x6905 and runs the blink-phase logic on C.
  m.step(0x04ac, 10);
  return m.call(0x04ac);
}

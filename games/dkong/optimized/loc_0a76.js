// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0a76 — hand-optimized rewrite of the translated routine at ROM 0x0A76,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (sub_0028 at 0x0028, the rst-0x28 inline-
 * jump-table trampoline) is reached through `m.call`, the routine registry
 * (games/dkong/routines.js), so it resolves to the oracle or to a future optimized
 * rewrite. Only the RAM name INTRO_STEP is imported (from ram.js).
 */

import { INTRO_STEP } from "./ram.js";

/**
 * loc_0a76 -- the opening Kong-climb cutscene STEP dispatcher.
 * [ROM 0x0A76-0x0A79]
 *
 *   0a76  3a 85 63   ld  a,(0x6385)   ; A = INTRO_STEP (0x6385)
 *   0a79  ef         rst 0x28         ; -> inline table 0x0A7A-0x0A89, 8 entries;
 *                                     ;    sub_0028 does jp (hl) to table[A]
 *
 * WHAT IT DOES. Reached one m.call level below loc_06fe: while a credited game is
 * in its opening cutscene (GAME_SUBSTATE 0x600A == 7), the in-game sub-state
 * dispatcher loc_06fe vectors here every frame. loc_0a76 loads the cutscene step
 * index INTRO_STEP (0x6385) and vectors through the 8-entry inline jump table at
 * 0x0A7A via the shared trampoline sub_0028, which `jp (hl)`'s to that step's
 * handler (loc_0a8a seeds the walk pointers, loc_0abf/loc_0ae8 advance Kong's
 * climb, the step-7 arm fires the roar audio 0x608A=0x0F, etc.). INTRO_STEP walks
 * 0->1->...->7 over the cutscene; each arm typically `inc (0x6385)` to advance the
 * next frame's step. Every arm is a short cutscene-setup routine -- NONE is the
 * interruptible per-frame gameplay loop (that is idx 13 of loc_06fe's OWN table,
 * one level up), which is what lets this one collapse its cycles where loc_06fe
 * cannot.
 *
 * INPUTS.  RAM: INTRO_STEP (0x6385), read into A. ROM: the jump table at 0x0A7A
 *   (read by sub_0028, not here). Registers on entry: none consumed.
 * OUTPUTS. Pushes the table base 0x0A7A onto the stack (rst 0x28's own return
 *   address, which sub_0028 pops to find the table) -- a write into diffed stack
 *   RAM. A = INTRO_STEP. Then whatever the dispatched step handler writes. The
 *   flags/registers on exit are entirely sub_0028's / the arm's; loc_0a76 sets
 *   none of its own that anything reads.
 *
 * NO INTERNAL BRANCH. loc_0a76 is straight-line: read -> push -> call. It does not
 * branch on A; the data-dependent behaviour lives entirely in the callee (the
 * table lookup + jp (hl)). So there is exactly ONE path through this routine,
 * exercised for every INTRO_STEP value with the same cycle total; the "branches" a
 * reviewer thinks of are the 8 dispatched step handlers, one m.call level down.
 * (The driven coin+start run below exercises all 8 selector values 0..7.)
 *
 * FLAGS. loc_0a76 computes no flags of its own -- neither `ld a,(nn)` nor `rst`
 * touches F. F on exit is whatever sub_0028 (its `add a,a` / `add hl,de`) and the
 * dispatched arm leave. The prologue is kept verbatim so A, F, SP and PC all match
 * the oracle exactly -- the unit gate compares the whole register file.
 *
 * LADDER STATUS -- rung 4 (idiomatic), cycles COLLAPSED to one total charge.
 * loc_0a76 runs INSIDE the vblank NMI (dispatchGameState is reached from the NMI
 * handler entry_0066, whose first act clears the NMI mask 0x7D84), so no nested NMI
 * can fire while it executes; and unlike its parent loc_06fe, its m.call(0x0028)
 * dispatches only to the SHORT cutscene-step arms (never the interruptible gameplay
 * handler), so no frame boundary falls inside it either. It is therefore ATOMIC,
 * its internal cycle distribution is free, and the two prologue charges (ld a = 13,
 * rst = 11) collapse to a single m.step of 24 -- harness-verified EQUAL whole-machine
 * (769 dispatches over frames 36..804, all 8 selector values) AND unit. This is the
 * SAME idiom + decision as loc_08b2 (the 2-entry state-2 dispatcher), NOT loc_06fe
 * (kept per-instruction precisely because it routes to gameplay).
 * The TOTAL is still load-bearing, as always: this frame's NMI cost sets the main
 * loop's vblank-spin count, which is the PRNG's entropy (README §2 / handler_05c6 /
 * SPIN_COUNT 0x6019), and it also fixes where a LATER frame's vblank NMI lands in
 * the diffed stack RAM -- so stripping the 24 (or charging a wrong total) diverges,
 * both verified. So: collapse = win (verified), drop = wrong. The push16/step/call
 * scaffolding of the rst calling convention stays -- sub_0028's `pop hl` needs the
 * pushed base.
 */
export function loc_0a76(m) {
  const { regs, mem } = m;

  // ld a,(INTRO_STEP) -- the cutscene step selector (0..7) for this frame.
  regs.a = mem.read8(INTRO_STEP);

  // rst 0x28 -- TAIL dispatch through the inline table at 0x0A7A. rst pushes the
  // table base as its "return address"; sub_0028 pops it, indexes table[A*2] from
  // ROM, and jp (hl)'s to the step handler. Reached via m.call so it resolves to
  // the oracle (or a future optimized rewrite).
  // Collapsed prologue charge: 13 (ld a) + 11 (rst) = 24 t, one m.step (atomic).
  m.push16(0x0a7a);
  m.step(0x0028, 24);
  m.call(0x0028, "0x0A7A (0x6385 sequence)");
}

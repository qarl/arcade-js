// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0038 — hand-optimized rewrite of the translated routine at ROM 0x0038,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its single successor, sub_003d (0x003D), is reached through
 * `m.call(0x003d)` — the routine registry (games/dkong/routines.js) — so it resolves
 * to the oracle or to sub_003d's own optimized rewrite, never a copy. loc_0038 reads
 * and writes NO fixed game address (it only loads two registers with immediates), so
 * nothing is imported from ram.js.
 */

/**
 * loc_0038 -- the `rst 0x38` entry: fix the stride/count, then FALL THROUGH.
 * [ROM 0x0038-0x003C, then falls through into sub_003d @ 0x003D]
 *
 *   0038  11 04 00   ld   de,0x0004   ; stride = 4
 *   003b  06 0a      ld   b,0x0a      ; count  = 10
 *   003d  ...        (falls through into sub_003d, no CALL, nothing pushed)
 *
 * WHAT IT DOES. This is the fixed-parameter doorway to sub_003d, the shared
 * "add C to a strided run of B bytes from HL" primitive. A `rst 0x38` (opcode 0xFF,
 * an 11 T call to 0x0038) lands here; loc_0038 hard-wires the two loop parameters the
 * rst form always uses -- stride DE = 4 and count B = 0x0A -- and then FALLS THROUGH
 * into sub_003d, which does the actual add-loop over the ten stride-4 bytes at HL.
 * The caller supplies HL (the base) and C (the addend); the rst form is used to lay
 * out the ten stride-4 fields of the 0x6908 sprite-object block during board and
 * opening-cutscene setup (observed live from frame ~160, HL = 0x6908, C in
 * {0x30, 0x80, 0xFC, ...}). The direct entry at 0x003D lets a caller choose DE/B
 * itself; that path does not pass through here.
 *
 * THE FALL-THROUGH IS NOT A CALL. 0x003B runs straight into 0x003D with nothing
 * pushed, so sub_003d's single `ret` at 0x0043 pops the address the `rst 0x38`
 * pushed at the original call site -- it returns to loc_0038's caller, not to
 * loc_0038. That is why `m.call(0x003d)` here has NO matching `m.push16`: modelling
 * a push (as if this were `call 0x003d`) would leave an extra word on the stack and
 * unbalance SP, which the unit gate (it compares SP) would catch. Keep it a bare
 * fall-through, exactly as the oracle does.
 *
 * INPUTS  (read):  none directly. HL and C are the caller's, read by sub_003d.
 * OUTPUTS (written): DE = 0x0004, B = 0x0A (the parameters sub_003d then consumes);
 *                  no memory, no flags. Everything the RAM sees -- the ten bytes
 *                  += C, HL advanced by 10*4, A, B := 0, and F (the final add-hl
 *                  carry) -- is produced by sub_003d, reached via m.call.
 *
 * FLAGS. `ld de,nn` and `ld b,n` touch NO flags, so loc_0038 leaves F exactly as it
 * found it, and the routine's only flag output is sub_003d's final `add hl,de`
 * carry, produced by the oracle (or optimized) sub_003d through m.call. Nothing is
 * dropped: both DE and B are load-bearing (sub_003d reads DE as the stride and B as
 * the djnz count), so there is no dead register churn to remove here -- the win is
 * the name, the plain-English contract, and the fall-through documented explicitly.
 *
 * ATOMICITY / CYCLES -- kept PER-INSTRUCTION (the two m.step charges, 10 T for
 *   `ld de` at 0x003b and 7 T for `ld b` at 0x003d, are NOT collapsed to one 17 T
 *   lump). loc_0038 is the `rst 0x38` vector -- the same rst family as sub_0008 /
 *   sub_0010 / sub_0018, all kept per-instruction -- and it is reached from 40+ sites
 *   (board setup, cutscene object staging, per-frame object updates). The brief's
 *   ATOMICITY-IS-PER-CALL-PATH rule governs: a collapse is safe only if the vblank
 *   NMI can never land between these two instructions on ANY call path. Empirically a
 *   coin+start run through board 1 dispatched loc_0038 220x, EVERY invocation with the
 *   NMI mask CLEARED (all reached from inside the mask-cleared NMI dispatch, so atomic
 *   on those trajectories) -- but that is exactly the "a short/driven run is NOT proof"
 *   case the brief names: the NMI simply never landed inside loc_0038 on that path, and
 *   later-board render callers (loc_1839 / loc_16a3 / loc_17b6 / loc_1880, all rst-0x38
 *   users) were not exercised. Collapsing would erase the intermediate PC 0x003b; if any
 *   unexercised or mask-enabled path ever accepted an NMI there, fireNmi would push
 *   0x003d instead of 0x003b into diffed stack RAM and diverge from MAME (README §2's
 *   "NMI lands mid-logic"). When unsure, per-instruction is always correct -- matching
 *   sub_003d (its own fall-through body), sub_0018, and sub_0020. The per-instruction
 *   charges also reproduce the oracle's exact cycle distribution; the single path's
 *   total (10 + 7 = 17 T through the fall-through) is preserved by construction. No
 *   hardware (0x7Dxx) write happens here -- only register loads -- so there is no
 *   write-bus-cycle position at stake.
 *
 * loc_0038 has NO data-dependent branch: it unconditionally sets DE and B and falls
 * through, whatever the caller passes. The single path is proven by the EQUAL/unit
 * gate and exercised 7x (>=1 required) by the driven whole-machine run, so branch
 * coverage is complete with no synthesised arms.
 */
export function loc_0038(m) {
  const { regs } = m;

  // ld de,0x0004 -- the stride sub_003d walks HL by.
  regs.de = 0x0004;
  m.step(0x003b, 10);

  // ld b,0x0a -- ten bytes for sub_003d's djnz count.
  regs.b = 0x0a;
  m.step(0x003d, 7);

  // FALL-THROUGH into sub_003d (0x003D): NOT a call, so no m.push16 -- sub_003d's
  // `ret` pops whatever the `rst 0x38` pushed at the caller's site (see header).
  m.call(0x003d);
}

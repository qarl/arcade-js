// SPDX-License-Identifier: GPL-3.0-only
/**
 * entry_0400 — hand-optimized rewrite of the translated routine at ROM 0x0400,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0038 the rst-0x38 sprite-offset helper,
 * 0x0413 the frame-flag colour-cycle tail) is reached through `m.call(0xADDR)`
 * via the routine registry (games/dkong/routines.js), so each resolves to the
 * oracle — or to its own optimized rewrite once one exists — never a copy. Only
 * RAM *names* are imported (from ram.js).
 */

import { SPRITE_OBJ_BLOCK } from "./ram.js";

/**
 * entry_0400 -- the attract/intro colour-cycle driver ENTERED AT 0x0400, i.e. at
 * the `jp nz,0x0413` mid-way through entry_03fb, with the Z flag as a LIVE-IN.
 * [ROM 0x0400-0x0412, then tail-calls loc_0413 @0x0413]
 *
 *   0400  c2 13 04   jp  nz,0x0413    ; Z live-in: NZ -> straight to the frame-flag tail
 *   0403  21 08 69   ld  hl,0x6908    ; Z-set arm (SPRITE_OBJ_BLOCK)
 *   0406  3a a3 63   ld  a,(0x63a3)
 *   0409  4f         ld  c,a          ; C = sprite-offset delta for rst 0x38
 *   040a  ff         rst 0x38         ; CALL loc_0038 -- offset one sprite record
 *   040b  3a 10 69   ld  a,(0x6910)
 *   040e  d6 3b      sub 0x3b
 *   0410  32 b7 63   ld  (0x63b7),a   ; derived index, read later by loc_0478
 *   0413  ...        (falls into loc_0413)
 *
 * WHAT IT DOES. This is the SAME body as entry_03fb (ROM 0x03FB), but entered one
 * instruction later — at 0x0400, the `jp nz,0x0413`. entry_03fb reaches 0x0400
 * having just done `ld a,(0x6227) / cp 0x02`, so its Z reflects BOARD==2. entry_0400
 * skips that test and takes Z straight from whoever entered it (documented as a
 * scheduled-task entry point whose task-runner leaves Z); the two arms are then
 * identical to entry_03fb's:
 *   - Z clear (NZ): `jp nz` taken -- go straight to the loc_0413 frame-flag tail,
 *     A and the incoming flags handed through untouched (loc_0413's first act is
 *     `ld a,(0x6391) / and a`, which overwrites both, so nothing here is observed).
 *   - Z set: point HL at SPRITE_OBJ_BLOCK (0x6908), load C = (0x63a3), rst 0x38
 *     (m.call(0x0038)) offsets one sprite record by C, then A = (0x6910) - 0x3B is
 *     stashed at 0x63b7 as a derived index (loc_0478 reads it back as its own
 *     rst-0x38 C), and control falls into loc_0413.
 * Both arms end in `return m.call(0x0413)`; the whole colour/counter tree beyond
 * (loc_0413, loc_0426, loc_0450, ... loc_0509) stays translated and is reached by
 * `m.call(0x0413)` unchanged.
 *
 * ★ THIS ROUTINE IS NEVER DISPATCHED IN THE CURRENT BUILD. The translator named it
 * "scheduled task 0x0400 handler", but the ROM's task-handler table at 0x0307 does
 * NOT contain address 0x0400 (its entries are 051c/059b/05c6/05e9/0611/062a/06b8,
 * verified by dumping the table), so dispatchTask's `jp (hl)` can never reach it.
 * There is no `m.call(0x0400)`
 * anywhere, and no other transfer targets 0x0400 (only entry_03fb flows THROUGH the
 * address as part of its own body). Measured: 0 entries over 1300 coin+start frames
 * (attract + a credited game + gameplay), with the no-override baseline running
 * clean the whole window — a genuine dispatch would throw NotImplemented from
 * dispatchTask (which has no 0x0400 arm). So this rewrite is proven by SYNTHESIS
 * from the reachable sibling entry_03fb's real captured entry state, not by a live
 * whole-machine dispatch (see equivalence-0400.test.js).
 *
 * NAMES. 0x6908 = SPRITE_OBJ_BLOCK is evidenced in ram.js. 0x63a3, 0x6910, 0x63b7
 * are engine/board scratch SHARED with the board-load code (loc_16bb compares 0x6910
 * vs 0x5A/0x5D and tests bit7 of 0x63a3; 0x63a3 is written at ROM 0x261F) — no single
 * settled meaning, so they stay hex (0x6910 also sits inside SPRITE_BUFFER, one record
 * past SPRITE_OBJ_BLOCK). Same treatment as entry_03fb.
 *
 * INPUTS: the Z flag (live-in) selects the branch; the Z-set arm additionally reads
 *   0x63a3 and 0x6910. OUTPUTS: the Z-set arm writes 0x63b7; both arms then run the
 *   loc_0413 tail (which owns all the colour-RAM writes, via sub_0514).
 *
 * FLAGS. On the NZ arm the oracle changes NOTHING between entry and the tail call, so
 *   A and the incoming F must be handed to m.call(0x0413) verbatim — this rewrite
 *   touches neither (it only READS regs.fNZ). On the Z-set arm the `sub 0x3b` result +
 *   flags (and whatever rst 0x38 left) are reproduced verbatim. loc_197a-style callers
 *   consume no return flag from this routine, but the UNIT gate compares the whole
 *   register file incl. F, so both arms match the oracle bit-for-bit by construction.
 *
 * ATOMIC? NO -- kept PER-INSTRUCTION (no cycle collapse), byte-identical to the oracle.
 *   Per the ATOMICITY-IS-PER-CALL-PATH rule this routine is non-atomic every way it
 *   could be entered: its documented role is a main-loop task entry (NMI mask ENABLED),
 *   and its body/tail are shared with entry_03fb whose caller loc_197a is the
 *   interruptible per-frame cascade — the vblank NMI can land inside the rst 0x38 or
 *   anywhere in the interruptible loc_0413 colour tree it flows into. So its internal
 *   cycle DISTRIBUTION is observable and every oracle m.step charge is retained. (There
 *   is in any case no live trajectory to measure a collapse against, since it never
 *   dispatches — per-instruction is the only defensible choice, and it is always
 *   correct.) Same decision and reason as entry_03fb / loc_197a. No hardware (0x7Dxx)
 *   write occurs here — the only store is 0x63b7 (work RAM) — so there is no
 *   write-trace caveat. This rung buys names + structure, not fewer operations.
 */
export function entry_0400(m) {
  const { regs, mem } = m;

  if (regs.fNZ) {
    // jp nz,0x0413 taken -- Z live-in clear: frame-flag tail with A + incoming flags live.
    m.step(0x0413, 10);
    return m.call(0x0413);
  }
  m.step(0x0403, 10); // jp nz NOT taken -> Z-set arm (the entry_03fb BOARD==2 body)

  // Z-set arm: rst-0x38 offsets one sprite record, then stash a derived index.
  regs.hl = SPRITE_OBJ_BLOCK;
  m.step(0x0406, 10); // ld hl,0x6908
  regs.a = mem.read8(0x63a3); // engine/board scratch -- shared, stays hex
  m.step(0x0409, 13); // ld a,(0x63a3)
  regs.c = regs.a; // rst 0x38 (loc_0038) reads C as the sprite-offset delta
  m.step(0x040a, 4); // ld c,a
  m.push16(0x040b); m.step(0x0038, 11); m.call(0x0038); // rst 0x38 = CALL loc_0038

  regs.a = mem.read8(0x6910); // inside SPRITE_BUFFER, shared w/ board-load -- stays hex
  m.step(0x040e, 13); // ld a,(0x6910)
  regs.sub(0x3b);
  m.step(0x0410, 7); // sub 0x3b
  mem.write8(0x63b7, regs.a); // derived index, read by loc_0478 -- stays hex
  m.step(0x0413, 13); // ld (0x63b7),a -- falls into 0x0413

  return m.call(0x0413);
}

// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0478 — hand-optimized rewrite of the translated routine at ROM 0x0478,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee is reached through `m.call(0xADDR)`, which
 * resolves via the routine registry (games/dkong/routines.js) to the oracle — or
 * to that callee's own optimized rewrite once one exists — so there is never a
 * copied implementation here to drift. Only the RAM name SPRITE_OBJ_BLOCK is
 * imported (from ram.js).
 */

import { SPRITE_OBJ_BLOCK } from "./ram.js";

/**
 * loc_0478 -- colour-cycle animation: BOARD-bit1-gated sprite reposition + colour
 * tail.  [ROM 0x0478-0x0485, then rst 0x38 (loc_0038) FALLS THROUGH into loc_0486]
 *
 *   0478  21 08 69   ld  hl,0x6908   ; HL = SPRITE_OBJ_BLOCK (10 sprite records)
 *   047b  0e 44      ld  c,0x44      ; C  = default rst-0x38 stride index
 *   047d  0f         rrca            ; carry = BOARD bit1 (A arrives BOARD ror-1)
 *   047e  d2 85 04   jp  nc,0x0485   ; BOARD bit1 == 0 -> keep C = 0x44
 *   0481  3a b7 63   ld  a,(0x63b7)  ; BOARD bit1 == 1 -> C = colour-cycle scratch
 *   0484  4f         ld  c,a
 *   0485  ff         rst 0x38        ; = call loc_0038: offset 10 records @HL by C
 *   ...  falls through into loc_0486 ; the shared colour tail (reached 7 ways)
 *
 * This is one leaf of the colour-cycle animation tree that entry_03fb (ROM 0x03FB)
 * drives every in-game frame through the per-frame cascade loc_197a. It is reached
 * from loc_0450's bit-dispatch on BOARD (0x6227) ONLY when BOARD's bit0 is clear
 * (even boards: 2=50m, 4=100m). A arrives already rotated once by loc_0450's `rrca`
 * (A = BOARD ror 1, since loc_0450 tested bit0), so THIS routine's `rrca` puts
 * BOARD's bit1 into carry:
 *   - bit1 == 0 (e.g. BOARD 4): keep the default sprite stride index C = 0x44.
 *   - bit1 == 1 (e.g. BOARD 2): load the index from the colour-cycle scratch byte
 *     0x63b7 (written by entry_03fb's BOARD==2 prologue as (0x6910)-0x3b).
 * Either way it then `rst 0x38` (loc_0038: stride-4, count-10 add-loop repositioning
 * the 10 sprite records at HL by C) and falls into loc_0486, the shared colour tail.
 *
 * INPUTS:  A (= BOARD ror 1, from loc_0450); RAM 0x63b7 on the bit1==1 arm.
 * OUTPUTS: HL, C, A, F set for the rst-0x38 hand-off; loc_0038 then writes the
 *          SPRITE_OBJ_BLOCK records and loc_0486 writes colour RAM.
 *
 * NAMES: 0x6908 = SPRITE_OBJ_BLOCK is evidenced in ram.js. 0x63b7 is colour-cycle
 * engine scratch shared with the board-load code (per entry_03fb.js/entry_0400.js,
 * which deliberately keep it hex); left hex here too, with a comment.
 *
 * FLAGS: the `rrca` is kept VERBATIM so both A (rotated) and F (carry = BOARD bit1)
 * match the oracle bit-for-bit at the rst-0x38 hand-off — the unit gate compares the
 * whole register file including F. Nothing here drops a flag: loc_0038 and loc_0486
 * are reached with byte-identical A/F to the oracle.
 *
 * ATOMIC? NO — kept PER-INSTRUCTION (byte-identical cycle charges to the oracle).
 * loc_0478's sole call path is the INTERRUPTIBLE per-frame cascade with the NMI mask
 * ENABLED: loc_197a (main-loop task) -> entry_03fb -> loc_0413 -> loc_0426 ->
 * loc_0450 -> loc_0478, and it then spans rst 0x38 plus the entire interruptible
 * loc_0486 colour tree. Per the ATOMICITY-IS-PER-CALL-PATH rule, a leaf reached from
 * an interruptible caller is not atomic, so the vblank NMI can land inside it and its
 * internal cycle DISTRIBUTION is observable — NO collapse. Every oracle m.step charge
 * is retained (same decision as entry_03fb, loc_197a, handler_01c3). This rung buys
 * names, structure and dropped register churn, not fewer operations.
 */
export function loc_0478(m) {
  const { regs, mem } = m;

  // ld hl,0x6908 / ld c,0x44 -- target the 10-record sprite-object block and
  // default the rst-0x38 stride index to 0x44.
  regs.hl = SPRITE_OBJ_BLOCK;
  m.step(0x047b, 10); // ld hl,0x6908
  regs.c = 0x44;
  m.step(0x047d, 7); // ld c,0x44

  // rrca -- rotate BOARD bit1 into carry (A arrives as BOARD ror 1 from loc_0450).
  regs.rrca();
  m.step(0x047e, 4); // rrca -- C(arry) = (0x6227) bit1

  if (regs.fNC) {
    // jp nc,0x0485 taken -- BOARD bit1 == 0: keep the default stride index 0x44.
    m.step(0x0485, 10);
  } else {
    // BOARD bit1 == 1: take the stride index from the colour-cycle scratch byte.
    // 0x63b7 is engine/board scratch (shared, unnamed in ram.js) -- kept hex.
    m.step(0x0481, 10); // jp nc not taken -> 0x0481
    regs.a = mem.read8(0x63b7);
    m.step(0x0484, 13); // ld a,(0x63b7)
    regs.c = regs.a;
    m.step(0x0485, 4); // ld c,a
  }

  // rst 0x38 -> loc_0038: stride-4, count-10 add-loop offsetting the 10 sprite
  // records at HL by C. It ends in `ret`, which pops the 0x0486 pushed here, so the
  // control then FALLS THROUGH into loc_0486 (the shared colour tail). Both callees
  // are reached via m.call so they resolve through the registry (oracle or rewrite).
  m.push16(0x0486); m.step(0x0038, 11); m.call(0x0038); // rst 0x38
  return m.call(0x0486);
}

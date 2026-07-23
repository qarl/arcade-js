// SPDX-License-Identifier: GPL-3.0-only
/**
 * entry_03fb — hand-optimized rewrite of the translated routine at ROM 0x03FB,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0038 the rst-0x38 sprite-offset helper,
 * 0x0413 the frame-flag tail) is reached through `m.call(0xADDR)` via the routine
 * registry (games/dkong/routines.js), so each resolves to the oracle — or to its
 * own optimized rewrite once one exists — never a copy. Only RAM *names* are
 * imported (from ram.js).
 */

import { BOARD, SPRITE_OBJ_BLOCK } from "./ram.js";

/**
 * entry_03fb -- ATTRACT / intro colour-cycle driver: prologue + BOARD dispatch.
 * [ROM 0x03FB-0x0412, then tail-calls loc_0413 @0x0413]
 *
 *   03fb  3a 27 62   ld  a,(0x6227)   ; A = BOARD
 *   03fe  fe 02      cp  0x02
 *   0400  c2 13 04   jp  nz,0x0413    ; BOARD != 2 -> straight to the frame-flag tail
 *   0403  21 08 69   ld  hl,0x6908    ; BOARD == 2 arm (SPRITE_OBJ_BLOCK)
 *   0406  3a a3 63   ld  a,(0x63a3)
 *   0409  4f         ld  c,a          ; C = sprite-offset delta for rst 0x38
 *   040a  ff         rst 0x38         ; CALL loc_0038 -- offset one sprite record
 *   040b  3a 10 69   ld  a,(0x6910)
 *   040e  d6 3b      sub 0x3b
 *   0410  32 b7 63   ld  (0x63b7),a   ; derived index, read later by loc_0478
 *   0413  ...        (falls into loc_0413)
 *
 * WHAT IT DOES. The whole 0x03FB-0x0513 span is Donkey Kong's attract/intro
 * colour-cycle + sprite animation driver; its ONE caller is loc_197a @0x19B0 (the
 * per-frame in-game cascade — it runs every frame of board 1, not only in
 * attract). This file rewrites ONLY the routine's PROLOGUE (0x03FB-0x0412): a
 * two-way dispatch on BOARD (0x6227). The tree of frame-flag / counter / colour
 * helpers it flows into (loc_0413, loc_0426, loc_0450, ... loc_0509) stay their
 * own translated exports and are reached by `m.call(0x0413)` unchanged.
 *
 * Two branches, BOTH ending in a tail-call to loc_0413:
 *   - BOARD (0x6227) != 2  (the HOT path -- board 1/25m holds BOARD=1, observed
 *     198/198 natural entries): `jp nz` taken; nothing else runs here.
 *   - BOARD == 2  (COLD -- reached only when the 50m board is the one on show):
 *     point HL at SPRITE_OBJ_BLOCK (0x6908), load C = (0x63a3), rst 0x38
 *     (m.call(0x0038)) offsets one sprite record by C, then A = (0x6910) - 0x3B is
 *     stashed at 0x63b7 as a derived index (loc_0478 reads it back as the rst-0x38
 *     C on its own arm), and control falls into loc_0413.
 *
 * NAMES. 0x6227 = BOARD and 0x6908 = SPRITE_OBJ_BLOCK are evidenced in ram.js.
 * 0x63a3, 0x6910, 0x63b7 are engine/board scratch SHARED with the board-load code
 * (loc_16bb compares 0x6910 vs 0x5A/0x5D and tests bit7 of 0x63a3; 0x63a3 is
 * written at ROM 0x261F) — no single settled meaning, so they stay hex (0x6910
 * also sits inside SPRITE_BUFFER, one record past SPRITE_OBJ_BLOCK).
 *
 * INPUTS: (0x6227) BOARD selects the branch; the BOARD==2 arm additionally reads
 *   0x63a3 and 0x6910. OUTPUTS: the BOARD==2 arm writes 0x63b7; both arms then run
 *   the loc_0413 tail (which owns all the colour-RAM writes, via sub_0514).
 *
 * FLAGS. Nothing here needs a flag preserved for its own sake — the immediate
 * downstream loc_0413 re-derives every flag it uses (`and a`, ...) and loc_197a
 * does NOT consume entry_03fb's return. But the UNIT gate compares the whole
 * register file incl. F, so the state handed to m.call(0x0413) must equal the
 * oracle's bit-for-bit: on the !=2 arm that is A and the `cp 0x02` flags; on the
 * ==2 arm the `sub 0x3b` result + flags (and whatever rst 0x38 left). Both arms
 * reproduce the oracle's operations verbatim, so F matches automatically.
 *
 * ATOMIC? NO -- kept PER-INSTRUCTION (no cycle collapse). Per the ATOMICITY-IS-
 * PER-CALL-PATH rule, entry_03fb's ONE caller is loc_197a, the interruptible
 * per-frame main-loop cascade (NMI mask ENABLED); the vblank NMI CAN land inside
 * this routine — it spans rst 0x38 and the entire interruptible loc_0413 colour
 * tree. A routine reached from an interruptible caller is not atomic, so its
 * internal cycle DISTRIBUTION is observable and every oracle m.step charge is
 * retained exactly. Same decision (and reason) as loc_197a itself and handler_01c3;
 * this rung buys names + structure, not fewer operations.
 */
export function entry_03fb(m) {
  const { regs, mem } = m;

  // ld a,(BOARD) / cp 0x02
  regs.a = mem.read8(BOARD);
  m.step(0x03fe, 13);
  regs.cp(0x02);
  m.step(0x0400, 7);

  if (regs.fNZ) {
    // jp nz,0x0413 taken -- BOARD != 2: frame-flag tail with A + cp flags live.
    m.step(0x0413, 10);
    return m.call(0x0413);
  }
  m.step(0x0403, 10); // jp nz NOT taken -> BOARD == 2 arm (COLD)

  // BOARD == 2 arm: rst-0x38 offsets one sprite record, then stash a derived index.
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

// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_09fe — hand-optimized rewrite of the translated routine at ROM 0x09FE,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. It calls no ROM subroutine (the block copy is the Z80
 * `ldir` instruction, a machine primitive, not a callee), so nothing is reached
 * through `m.call` here. Only RAM *names* are imported (from ram.js).
 */

import {
  P2_CONTEXT,
  LIVES,
  BOARD,
  BOARD_SEQ_PTR,
  SUBSTATE_TIMER,
  GAME_SUBSTATE,
} from "./ram.js";

/**
 * sub_09fe -- restore player 2's saved context and arm the board-setup wait.
 * [ROM 0x09FE-0x0A1A]
 *
 *   09fe  21 48 60     ld   hl,0x6048       ; HL = P2_CONTEXT (P2's saved 8-byte block)
 *   0a01  11 28 62     ld   de,0x6228       ; DE = live player block (base = LIVES)
 *   0a04  01 08 00     ld   bc,0x0008
 *   0a07  ed b0        ldir                 ; copy 8 bytes P2_CONTEXT -> live block
 *   0a09  2a 2a 62     ld   hl,(0x622a)     ; HL = *(BOARD_SEQ_PTR), a ROM pointer
 *   0a0c  7e           ld   a,(hl)          ; A  = board id at that pointer
 *   0a0d  32 27 62     ld   (0x6227),a      ; BOARD = board id
 *   0a10  3e 78        ld   a,0x78
 *   0a12  32 09 60     ld   (0x6009),a      ; SUBSTATE_TIMER = 0x78 (120 frames)
 *   0a15  3e 04        ld   a,0x04
 *   0a17  32 0a 60     ld   (0x600a),a      ; GAME_SUBSTATE = 4 (next sub-state)
 *   0a1a  c9           ret
 *
 * THE PLAYER-2 CONTEXT RESTORE. Twin of loc_09ab (which restores P1 from 0x6040);
 * this one copies P2's saved 8-byte context (P2_CONTEXT = 0x6048: LIVES, LEVEL,
 * BOARD_SEQ_PTR lo/hi, PLAY_INTRO, BONUS_LIFE_AWARDED, HOW_HIGH_INDEX,
 * HOW_HIGH_LAST_SEQ) into the LIVE player block at 0x6228, then re-derives the
 * current BOARD by dereferencing the just-restored BOARD_SEQ_PTR into the ROM
 * board-order table, and finally arms the sub-state machine to wait 0x78 frames
 * (SUBSTATE_TIMER) before advancing to sub-state 4 (GAME_SUBSTATE). Reached in a
 * 2-player game the moment control passes to player 2 (P1 loses a life).
 *
 * Unlike loc_09ab, sub_09fe has NO data-dependent branch: it is straight-line,
 * one path, always the same stores. (loc_09ab branches on 0x600F to pick the
 * arm/timer; this P2 variant hard-codes 0x78 / 4.)
 *
 * Inputs  (read):  P2_CONTEXT[0..7] (0x6048-0x604F), BOARD_SEQ_PTR word (0x622A),
 *                  and the ROM board-order byte it points at.
 * Outputs (write): live block 0x6228-0x622F (= P2's context), BOARD, SUBSTATE_TIMER,
 *                  GAME_SUBSTATE. Registers left as the oracle leaves them:
 *                  HL = the restored BOARD_SEQ_PTR value, DE = 0x6230 and BC = 0
 *                  (where the ldir leaves them), A = 0x04.
 *
 * FLAGS: none are set. Every instruction is a load, a block copy, or the ret;
 * `ldir` in this translation (machine.ldirAt) does not touch F, and neither do the
 * `ld`s -- so F passes through from entry unchanged, identically on both sides. The
 * unit gate compares F and confirms it. The caller (dispatchGameState's rst-0x28
 * dispatch, returning to 0x00D2) consumes no flag from here.
 *
 * LADDER STATUS -- idiomatic, cycles collapsed to ONE total charge (279 t).
 * sub_09fe is ATOMIC: it makes no call to an interruptible routine, and it runs
 * INSIDE the vblank NMI (dispatched from entry_0066, which clears the NMI mask
 * 0x7D84 on entry), so no nested NMI can fire while it executes. The NMI itself
 * fires at the frame boundary (NMI_CYCLE_IN_FRAME = 0), so this 279-cycle routine
 * sits at the very start of a ~50688-cycle frame budget -- no frame boundary lands
 * inside it, so its internal cycle DISTRIBUTION is unobservable. Charging the
 * path's per-instruction sum (10+10+10+163+16+7+13+7+13+7+13+10 = 279; the 163 is
 * the ldir's 7*21 + 16) as a single m.ret(279) stays EQUAL whole-machine AND unit
 * -- harness-verified, per README §2. The TOTAL is preserved because it is still
 * observable through the main-loop spin count (README §2); only its distribution
 * is free. (Same finding as entry_0611 / loc_08b2, both atomic NMI-path routines.)
 */
export function sub_09fe(m) {
  const { regs, mem } = m;

  // ldir: copy P2's 8-byte saved context into the live player block. The Z80
  // leaves HL past the source (0x6050), DE past the dest (0x6230), BC = 0.
  for (let i = 0; i < 8; i++) mem.write8(LIVES + i, mem.read8(P2_CONTEXT + i));
  regs.de = (LIVES + 8) & 0xffff; // 0x6230
  regs.bc = 0;
  // (HL is left at 0x6050 by the ldir but immediately overwritten below, so it is
  // not reproduced -- only the observable final HL, the pointer value, is.)

  // BOARD = *(BOARD_SEQ_PTR): deref the restored 16-bit ROM pointer at 0x622A.
  regs.hl = mem.read16(BOARD_SEQ_PTR);
  regs.a = mem.read8(regs.hl);
  mem.write8(BOARD, regs.a);

  // Arm the sub-state machine: wait 0x78 frames, then advance to sub-state 4.
  regs.a = 0x78;
  mem.write8(SUBSTATE_TIMER, regs.a);
  regs.a = 0x04;
  mem.write8(GAME_SUBSTATE, regs.a);

  // ATOMIC routine: charge the whole path's 279 t-states once, on the ret.
  m.ret(279);
}

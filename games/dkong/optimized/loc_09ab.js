// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_09ab — hand-optimized rewrite of the translated routine at ROM 0x09AB,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. loc_09ab makes no inter-routine call at all, so there is
 * nothing here to reach through `m.call`; only RAM *names* are imported (ram.js).
 */

import {
  P1_CONTEXT,
  LIVES,
  BOARD_SEQ_PTR,
  BOARD,
  SUBSTATE_TIMER,
  GAME_SUBSTATE,
} from "./ram.js";

// 0x600F is unnamed in ram.js (no re-derived evidence), so it stays hex. It is a
// game-context selector read at several starts (ROM 0x0334 score-routing, 0x079E
// `cp 1`, 0x1318/0x1339); here `and a` only tests it for zero. Left hex per the
// "name only what can be evidenced" rule.
const CONTEXT_SELECT = 0x600f;

/**
 * loc_09ab -- restore the up player's saved context, re-derive the board, and arm
 * the next in-game sub-state.  [ROM 0x09AB-0x09D5]
 *
 *   09ab  ld   hl,0x6040          ; P1_CONTEXT
 *   09ae  ld   de,0x6228          ; LIVES (head of the live 8-byte context block)
 *   09b1  ld   bc,0x0008
 *   09b4  ldir                    ; 0x6040..0x6047 -> 0x6228..0x622F
 *   09b6  ld   hl,(0x622a)        ; INDIRECT: HL = *BOARD_SEQ_PTR (the just-copied ptr)
 *   09b9  ld   a,(hl)             ; deref -> the board-type byte in ROM
 *   09ba  ld   (0x6227),a         ; BOARD
 *   09bd  ld   a,(0x600f)         ; context selector
 *   09c0  and  a                  ; Z iff 0x600F == 0
 *   09c1  ld   hl,0x6009          ; SUBSTATE_TIMER
 *   09c4  ld   de,0x600a          ; GAME_SUBSTATE
 *   09c7  jp   z,0x09d0
 *   09ca  ld   (hl),0x78          ; 0x600F != 0 -> timer = 0x78 (120 frames)
 *   09cc  ex   de,hl
 *   09cd  ld   (hl),0x02          ; sub-state = 2
 *   09cf  ret
 *   09d0  ld   (hl),0x01          ; 0x600F == 0 -> timer = 1
 *   09d2  ex   de,hl
 *   09d3  ld   (hl),0x05          ; sub-state = 5
 *   09d5  ret
 *
 * WHAT IT DOES. Run from the in-game (GAME_STATE 3) sub-state dispatcher
 * (loc_06fe's 0x0702 table, reached via the vblank NMI) when a game/board starts:
 *   1. Restore the up player's 8-byte saved context -- LIVES, LEVEL, BOARD_SEQ_PTR
 *      (lo,hi), PLAY_INTRO, BONUS_LIFE_AWARDED, HOW_HIGH_INDEX, HOW_HIGH_LAST_SEQ --
 *      by copying P1_CONTEXT (0x6040..0x6047) into the live block at LIVES (0x6228).
 *   2. Re-derive BOARD (0x6227) by dereferencing the freshly-restored BOARD_SEQ_PTR:
 *      `ld hl,(0x622a)` reads the *pointer* copied in step 1, then `ld a,(hl)` fetches
 *      the board-type byte it points at in ROM, and that byte is stored to BOARD.
 *   3. Arm the next sub-state from the 0x600F context selector: 0 -> SUBSTATE_TIMER=1
 *      and GAME_SUBSTATE=5; non-zero -> SUBSTATE_TIMER=0x78 (120 frames) and
 *      GAME_SUBSTATE=2. (The sibling loc_09fe does the identical thing for player 2
 *      from P2_CONTEXT, ROM 0x09FE.)
 *
 * INPUTS  (read): P1_CONTEXT[0..7], the *word* at BOARD_SEQ_PTR and the ROM byte it
 *   points at, the selector byte 0x600F.
 * OUTPUTS (written): LIVES..0x622F (8 bytes), BOARD, SUBSTATE_TIMER, GAME_SUBSTATE.
 *
 * FLAGS. `and a` sets F from the selector; nothing after it is flag-sensitive except
 * the `jp z` it feeds. No caller consumes F on return (this is a dispatch target that
 * `ret`s straight back into loc_06fe's rst-0x28 tail), but the unit gate compares the
 * WHOLE register file, so the final file is reproduced verbatim: A = 0x600F's value,
 * F = that value's and-a flags, BC = 0 (ldir drains it), DE = 0x6009 and HL = 0x600A
 * (the oracle's `ex de,hl` leaves the pair swapped this way in BOTH branches).
 *
 * LADDER STATUS -- rung 4 (idiomatic), cycles collapsed to one total per branch.
 * loc_09ab is ATOMIC: it makes NO call (no `m.call` at all), so the vblank NMI
 * cannot land inside it (the handler is already the NMI, and nothing here spans a
 * frame). Both branches sum to the SAME total: common prefix 266 t (incl. the LDIR's
 * 7*21+16 = 163) + a 44 t tail (jp/ld/ex/ld/ret) = 310 t. Charging that single 310 in
 * one `m.ret` per branch stays EQUAL whole-machine AND unit (harness-verified over a
 * driven coin+start run); the per-instruction distribution -- including the LDIR's
 * intermediate PC=0x01cf churn -- is unobservable because no boundary lands inside.
 * The TOTAL is kept, not dropped: this runs in the NMI, whose total cost sets the
 * main-loop spin count that seeds the PRNG (README §2), so a wrong total would drift
 * downstream state.
 */
export function loc_09ab(m) {
  const { regs, mem } = m;

  // ldir: restore the up player's 8-byte context P1_CONTEXT -> live block at LIVES.
  for (let i = 0; i < 8; i++) mem.write8(LIVES + i, mem.read8(P1_CONTEXT + i));

  // ld hl,(0x622a) / ld a,(hl) / ld (0x6227),a -- re-derive BOARD from *BOARD_SEQ_PTR.
  mem.write8(BOARD, mem.read8(mem.read16(BOARD_SEQ_PTR)));

  // ld a,(0x600f) / and a -- Z iff the context selector is 0. Reproduce A and F.
  regs.a = mem.read8(CONTEXT_SELECT);
  regs.and(regs.a);

  // Final register file after the oracle's loads + `ex de,hl` (both branches):
  // BC drained to 0 by the ldir; DE/HL swapped to 0x6009/0x600A.
  regs.bc = 0x0000;
  regs.de = 0x6009;
  regs.hl = 0x600a;

  if (regs.fZ) {
    // 0x600F == 0 -> arm sub-state 5 after a 1-frame timer.  branch total 310 t.
    mem.write8(SUBSTATE_TIMER, 0x01);
    mem.write8(GAME_SUBSTATE, 0x05);
    m.ret(310);
    return;
  }

  // 0x600F != 0 -> arm sub-state 2 after a 0x78 (120)-frame timer.  branch total 310 t.
  mem.write8(SUBSTATE_TIMER, 0x78);
  mem.write8(GAME_SUBSTATE, 0x02);
  m.ret(310);
}

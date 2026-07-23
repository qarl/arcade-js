// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_08d5 — hand-optimized rewrite of the translated routine at ROM 0x08D5,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x05e9, 0x0616) is reached through
 * `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to that callee's own optimized rewrite once one
 * exists — never a copied implementation. Only RAM *names* are imported (ram.js);
 * IN2 is a board input latch (0x7Dxx), not work RAM, so — like handler_01c3's
 * FLIPSCREEN and loc_08ba's PALETTE_BANK_0 — it is a local const here.
 */

import { CREDITS, FRAME } from "./ram.js";

// IN2 (0x7D00): the coin/start input port. READING it also kicks the watchdog
// (boards/dkong/io.js readIn2). A board input latch, not work RAM, so it stays
// hex/local like FLIPSCREEN. bit2 = START1 (0x04), bit3 = START2 (0x08).
const IN2 = 0x7d00;

/**
 * loc_08d5 -- read the start-button selector on the credit screen (and, once
 * every 8 frames, redraw the "push start" prompt).  [ROM 0x08D5-0x08F7]
 *
 *   08d5  06 04        ld   b,0x04
 *   08d7  1e 09        ld   e,0x09
 *   08d9  3a 01 60     ld   a,(CREDITS)   ; 0x6001
 *   08dc  fe 01        cp   0x01
 *   08de  ca e4 08     jp   z,0x08e4      ; ==1 -> B=4,E=9 ; else B=0xC,E=0xA
 *   08e1  06 0c        ld   b,0x0c
 *   08e3  1c           inc  e
 *   08e4  3a 1a 60     ld   a,(FRAME)     ; 0x601a
 *   08e7  e6 07        and  0x07
 *   08e9  c2 f3 08     jp   nz,0x08f3     ; (FRAME&7)!=0 -> SKIP the two calls
 *   08ec  7b           ld   a,e
 *   08ed  cd e9 05     call 0x05e9        ; handler_05e9: draw prompt string E
 *   08f0  cd 16 06     call 0x0616        ; sub_0616
 *   08f3  3a 00 7d     ld   a,(IN2)       ; 0x7D00 -- kicks the watchdog
 *   08f6  a0           and  b
 *   08f7  c9           ret                ; A (and flags) = IN2 & B = the start selector
 *
 * WHAT IT DOES. Called every frame while a game is credited (game state 2), by
 * BOTH sub-state arms — loc_08ba (sub-state 0) falls through into it, loc_08f8
 * (sub-state 1) calls it — it does two things:
 *
 *   (1) Builds the start-button MASK in B and the prompt-string index in E from
 *       CREDITS: exactly one credit -> B=0x04 (START1 only), E=0x09; any other
 *       credit count -> B=0x0C (START1|START2), E=0x0A. So with a single credit
 *       only the 1-player start button is honoured, and the prompt differs.
 *   (2) Once every 8 frames ((FRAME & 7) == 0) redraws that prompt: ld a,e puts
 *       the string index in A and calls handler_05e9 (a doubly-indirected string
 *       draw) then sub_0616. On the other 7 frames it skips straight to the read.
 *
 *   Finally it returns A = IN2(0x7D00) & B — the pressed start button(s), masked
 *   to the ones this credit count allows. loc_08f8 consumes exactly that byte:
 *   0x04 -> 1-player start, 0x08 -> 2-player start, else (0x00 / 0x0C) -> wait.
 *
 * INPUTS (read): CREDITS(0x6001), FRAME(0x601a), IN2(0x7D00). No register inputs.
 * OUTPUTS (work RAM written by THIS routine): NONE — loc_08d5 writes no work RAM
 *   of its own; the only stores on the draw arm are handler_05e9/sub_0616's VRAM
 *   draw, reached via m.call so they run the oracle (or their own rewrites).
 *   Register outputs: A = IN2 & B (the return value). On the 7-in-8 SKIP frames B
 *   is the mask this routine built (0x04 / 0x0C), E is 0x09 / 0x0A, and C/D/HL/IX/
 *   IY/SP are untouched. On the 1-in-8 DRAW frames the two callees CLOBBER A/B/C/D/
 *   E/HL/F before the final `and b`, so the returned selector is IN2 & whatever-B-
 *   the-callees-left (observed 0) — NOT the built mask. That is the oracle's own
 *   quirk (the draw and the read share the `and b`), and it is faithful only because
 *   this rewrite passes the LIVE regs.b — the callee-clobbered value — to `and b`,
 *   never the 0x04/0x0C it set at the top. loc_08f8 tolerates it: it re-runs every
 *   frame and acts only on a clean 0x04 / 0x08, which land on the skip frames.
 *
 * FLAGS. loc_08d5 ends in a plain `ret`, and F at exit is the `and b` result. The
 * one caller that inspects the return, loc_08f8, immediately does `cp 0x04`, which
 * OVERWRITES loc_08d5's flags — it consumes only A, not F. The other entry
 * (loc_08ba's fall-through) returns straight to the NMI dispatch, which branches
 * on no flag loc_08d5 set. So no downstream code reads F; it is kept verbatim
 * (the real `regs.and(regs.b)`) only so the unit gate, which compares the whole
 * register file F included, sees an identical F. Every intermediate flag op
 * (`cp 0x01`, `inc e`, `and 0x07`) is likewise kept because it either decides a
 * branch or is the last writer of F on its path.
 *
 * LADDER STATUS -- idiomatic, cycles collapsed to one total per straight-line
 * segment (each folds the following CALL's 17t; the callees charge themselves).
 * loc_08d5 is ATOMIC: it is reached ONLY inside the vblank NMI — both call paths
 * root in dispatchGameState (NMI game-state dispatch): loc_08ba (fall-through) and
 * loc_08f8 (m.call), each a 0x08B6 table arm dispatched when GAME_STATE(0x6005)==2.
 * The NMI handler clears the NMI mask (0x7D84) before dispatching, so the vblank
 * NMI cannot re-fire anywhere inside loc_08d5 OR its callees — exactly the reason
 * loc_08ba's own header names "loc_08d5's interruptible 0x05e9/0x0616 arm" as a
 * downstream landing that never happens here. So loc_08d5's internal cycle
 * DISTRIBUTION is unobservable and collapses; the per-branch TOTAL is still
 * load-bearing (as part of the NMI's total it sets the main-loop spin count —
 * README §2, SPIN_COUNT 0x6019), so each branch preserves its exact per-
 * instruction sum: skip-calls arms 101t (B=4) / 112t (B=0xC), draw arms 139t
 * (B=4) / 150t (B=0xC), each excluding the callee bodies. NO hardware WRITE
 * happens here (the only 0x7Dxx touch is the IN2 read, whose watchdog kick just
 * zeroes a per-FRAME counter and is cycle-position-insensitive), so there is no
 * write-trace column to protect — unlike loc_08ba's palette-bank latches, this one
 * collapses fully. Whole-machine EQUAL over the coin+start window confirms the
 * reached totals; the synthesised branch tests assert the totals on the arms the
 * driven run does not reach.
 */
export function loc_08d5(m) {
  const { regs, mem } = m;

  // 0x08D5 ld b,4 / 0x08D7 ld e,9 / 0x08D9 ld a,(CREDITS) / 0x08DC cp 1
  regs.b = 0x04;
  regs.e = 0x09;
  regs.a = mem.read8(CREDITS); // 0x6001
  regs.cp(0x01);

  if (regs.fZ) {
    // credits == 1: START1 only (B=4), prompt E=9. jp z taken.
    // run 0x08D5..jp-z-taken = 7+7+13+7+10 = 44t, ends at 0x08e4.
    m.step(0x08e4, 44);
  } else {
    // credits != 1: START1|START2 (B=0xC), prompt E=0xA. jp z not taken.
    regs.b = 0x0c;
    regs.e = regs.inc8(regs.e); // inc e -- 8-bit, D untouched
    // run = 7+7+13+7 + 10(jp not taken) + 7(ld b) + 4(inc e) = 55t, ends at 0x08e4.
    m.step(0x08e4, 55);
  }

  // 0x08E4 ld a,(FRAME) / 0x08E7 and 0x07 -- redraw the prompt once every 8 frames.
  regs.a = mem.read8(FRAME); // 0x601a
  regs.and(0x07);

  if (regs.fNZ) {
    // (FRAME & 7) != 0 -- the 7-in-8 common case: SKIP the draw. jp nz taken.
    // run 0x08E4..jp-nz-taken = 13+7+10 = 30t, ends at 0x08f3.
    m.step(0x08f3, 30);
  } else {
    // (FRAME & 7) == 0 -- redraw the prompt string (index in E).
    regs.a = regs.e; // ld a,e
    // 0x08ED call 0x05e9 -- fold 0x08E4..the CALL: 13+7+10(jp not taken)+4(ld a,e)+17 = 51t.
    m.push16(0x08f0);
    m.step(0x05e9, 51);
    m.call(0x05e9); // handler_05e9 (returns normally to 0x08F0)
    // 0x08F0 call 0x0616
    m.push16(0x08f3);
    m.step(0x0616, 17);
    m.call(0x0616);
  }

  // 0x08F3 ld a,(IN2) / 0x08F6 and b / 0x08F7 ret -- A (and F) = IN2 & B.
  regs.a = mem.read8(IN2); // 0x7D00 -- kicks the watchdog
  regs.and(regs.b); // and b -- A and flags are the return value
  // run 0x08F3..and-b = 13+4 = 17t, then ret (10t).
  m.step(0x08f7, 17);
  m.ret(10);
}

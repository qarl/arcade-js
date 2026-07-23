// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0cc6 — hand-optimized rewrite of the translated routine at ROM 0x0CC6,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0DA7, 0x0D00, 0x3FA0) is reached through
 * `m.call(0xADDR)`, which resolves via the routine registry (games/dkong/routines.js)
 * to the oracle — or to that callee's own optimized rewrite once one exists — so
 * there is never a copied implementation here to drift. Only RAM *names* are
 * imported (from ram.js).
 */

import { BOARD } from "./ram.js";

/**
 * loc_0cc6 -- the shared tail every board-setup dispatch arm converges on.
 * [ROM 0x0CC6-0x0CD3]
 *
 *   0cc6  cd a7 0d     call 0x0da7        ; walk the DE-selected layout table
 *   0cc9  3a 27 62     ld   a,(0x6227)    ; A = BOARD
 *   0ccc  fe 04        cp   0x04
 *   0cce  cc 00 0d     call z,0x0d00      ; board 4 (rivet) only: extra fill pass
 *   0cd1  c3 a0 3f     jp   0x3fa0        ; TAIL jump into the rest of board setup
 *
 * WHAT IT DOES. The four board-setup arms (loc_0cd4 board 1 girders, loc_0cdf
 * board 2 conveyors, loc_0cf2 board 3 elevators, and the loc_0cb6 fall-through
 * board 4 rivets) each leave DE pointing at their own ROM layout table and then
 * reach here. This tail:
 *   - call 0x0da7 (sub_0da7): walk that DE-selected 0xAA-terminated table,
 *     drawing the board's tiles into video RAM / the 0x63AB.. region.
 *   - Read BOARD (0x6227); if it is 4 (100m rivets) ALSO call 0x0d00, which
 *     block-fills the eight rivet cells from the 0x0D17 table. `call z` fires on
 *     this arm alone — the other three arms enter with BOARD in {1,2,3}.
 *   - jp 0x3fa0 (loc_3fa0): a TAIL jump (no return pushed). loc_3fa0 calls
 *     sub_3fa6 then tail-jumps loc_0d5f, whose eventual `ret` returns to
 *     loc_0cc6's caller — i.e. this routine has no `ret` of its own.
 *
 * INPUTS: BOARD (0x6227) selects the extra-pass branch; DE (live-in from the
 *   calling arm) is the layout-table pointer sub_0da7 consumes; the rest is
 *   immediates and ROM tables the callees walk. OUTPUTS: everything the callees
 *   write (board tiles in VRAM, the rivet cells, and all of loc_0d5f's downstream
 *   board setup); loc_0cc6 itself writes no RAM directly. A ends = BOARD; F ends =
 *   `cp 0x04`'s result on the not-taken arm, or whatever the callees leave.
 *
 * FLAGS: the only flag this routine sets is `cp 0x04`, whose Z IS the `call z`
 *   decision — kept verbatim (regs.cp) so both the branch and F match the oracle.
 *   A is likewise kept (regs.a = read(BOARD)); the callees re-establish their own
 *   A/F, and the unit gate compares the whole register file (F and A included),
 *   which confirms nothing observed diverges.
 *
 * ATOMIC — cycles collapsed to one total per inter-call segment, TOTAL preserved.
 *   loc_0cc6 runs INSIDE the vblank NMI: it is reached only through the game-state
 *   rst-0x28 dispatch (handler_0763 -> jp 0x0c92 -> the board cascade -> here, and
 *   the loc_0c91 "nmi-local" twin), and entry_0066 clears the NMI mask (0x7D84<-0)
 *   for the whole handler, so a second vblank cannot re-enter until the epilogue.
 *   GREP confirms all four `m.call(0x0cc6)` sites (loc_0cd4/0cdf/0cf2 and the
 *   loc_0cb6 fall-through) sit on that one NMI path — none is a main-loop task or
 *   an interruptible cascade. So the NMI never lands inside loc_0cc6 OR any of its
 *   callees, and its internal cycle DISTRIBUTION is unobservable.
 *
 *   The collapse preserves the exact cumulative clock at EACH `m.call` entry by
 *   lumping the intervening `ld/cp` charges into the `m.step` immediately before
 *   the next call: sub_0da7 enters at +17; on the taken arm 0x0d00 enters at +37
 *   (13+7+17) and 0x3fa0 at +10 after it; on the not-taken arm 0x3fa0 enters at
 *   +40 (13+7+10+10). Those are identical to the oracle's per-instruction sums, so
 *   the callees' own writes (including any hardware/VRAM bus positions) are
 *   untouched — loc_0cc6 makes no hardware or memory write of its own to shift.
 *   Branch TOTALS (own charges): taken 17+37+10 = 64t, not-taken 17+40 = 57t;
 *   both preserved exactly. The total is still load-bearing — as part of the NMI
 *   cost it sets the main-loop spin count (README §2, SPIN_COUNT) — so whole-
 *   machine EQUAL (a wrong total would diverge at 0x6019) confirms the sum.
 */
export function loc_0cc6(m) {
  const { regs, mem } = m;

  // call 0x0da7 (17t) -- walk the DE-selected layout table into VRAM / 0x63AB..
  m.push16(0x0cc9);
  m.step(0x0da7, 17);
  m.call(0x0da7);

  // ld a,(BOARD) / cp 0x04 -- board 4 (rivets) gets an extra 0x0d00 fill pass.
  regs.a = mem.read8(BOARD);
  regs.cp(0x04);

  if (regs.fZ) {
    // call z,0x0d00 TAKEN (board 4). ld(13)+cp(7)+call(17) = 37t up to the call,
    // so 0x0d00 enters at the oracle's exact cumulative clock.
    m.push16(0x0cd1);
    m.step(0x0d00, 37);
    m.call(0x0d00);
    // jp 0x3fa0 (10t) -- tail into the rest of board setup.
    m.step(0x3fa0, 10);
  } else {
    // call z NOT taken (boards 1/2/3). ld(13)+cp(7)+notcall(10)+jp(10) = 40t,
    // so 0x3fa0 enters at the oracle's exact cumulative clock.
    m.step(0x3fa0, 40);
  }

  // jp 0x3fa0 -- TAIL jump, no return address pushed; loc_0d5f's ret returns for us.
  m.call(0x3fa0);
}

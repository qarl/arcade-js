// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0cdf — hand-optimized rewrite of the translated routine at ROM 0x0CDF,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0CC6, the shared board-draw tail) is
 * reached through `m.call`, the routine registry (games/dkong/routines.js), so it
 * resolves to the oracle — or to a future optimized rewrite — never a copy. Only
 * the RAM name SND_BGM is imported (from ram.js); the two 0x7Dxx palette-bank
 * latches are board hardware outputs, not work RAM, so they stay bare constants.
 */

import { SND_BGM } from "./ram.js";

// The two-bit palette-bank select latch (ls259.6h at 0x7D86/0x7D87) — a board
// control OUTPUT decoded by io.writePaletteBank, NOT work RAM, so it is not in
// ram.js. loc_0cdf sets the bank to %01: LO<-1, HI<-0. (The four board arms of
// loc_0c92 leave the two bits in different states; this arm rewrites BOTH.)
const PALETTE_BANK_LO = 0x7d86;
const PALETTE_BANK_HI = 0x7d87;

/**
 * loc_0cdf -- board 2 (50m conveyor) setup. [ROM 0x0CDF-0x0CF1, then a tail-jump
 * into the shared board-draw tail loc_0cc6 @ 0x0CC6.]
 *
 *   0cdf  11 5d 3b     ld   de,0x3b5d      ; DE = 50m conveyor layout ptr (live-out)
 *   0ce2  21 86 7d     ld   hl,0x7d86      ; -> palette-bank LO latch
 *   0ce5  36 01        ld   (hl),0x01      ; palette bank bit0 = 1   [HW write]
 *   0ce7  23           inc  hl             ; -> palette-bank HI latch
 *   0ce8  36 00        ld   (hl),0x00      ; palette bank bit1 = 0   [HW write]
 *   0cea  3e 09        ld   a,0x09
 *   0cec  32 89 60     ld   (0x6089),a     ; SND_BGM = 9 (50m background tune)
 *   0cef  c3 c6 0c     jp   0x0cc6         ; TAIL into the shared draw tail
 *
 * WHAT IT DOES. The board-2 arm of loc_0c92's `dec a / jp z` board-type cascade
 * (reached when BOARD(0x6227)==2). Straight-line, ONE path, no data-dependent
 * branch. It (a) points DE at the 50m conveyor object-layout table at ROM 0x3B5D,
 * which the shared tail (loc_0cc6 -> sub_0da7) walks; (b) selects palette bank %01
 * by writing the two ls259.6h bank latches (LO<-1, HI<-0); (c) sets SND_BGM(0x6089)
 * to 9, the 50m background tune; then (d) tail-jumps into loc_0cc6 (whose own `ret`
 * — via loc_3fa0/loc_0d5f — returns for us, so loc_0cdf has no `ret` of its own).
 *
 * INPUTS (read): none — every value is an immediate. OUTPUTS (write): the two
 * palette-bank latches (0x7D86<-1, 0x7D87<-0); SND_BGM(0x6089)<-9; and DE left =
 * 0x3B5D as a live-out consumed by sub_0da7 through the shared tail. On exit A=0x09,
 * HL=0x7D87, DE=0x3B5D — all matching the oracle (checked by the unit register diff).
 *
 * FLAGS. loc_0cdf executes only `ld` / `inc hl` (16-bit) / `jp` — NONE of which
 * touch a flag — so F is exactly whatever it was on entry, on both sides. This
 * rewrite likewise writes no flag, so the unit gate's full register-file+F compare
 * matches. Nothing downstream consumes a flag from here anyway (loc_0cc6's first act
 * is a `call`, then `ld a,(0x6227)`).
 *
 * ATOMIC — cycles partially collapsed, TOTAL preserved (76t of loc_0cdf proper,
 * plus the shared tail's own charges via m.call). loc_0cdf's ONLY executable call
 * path is loc_0c92's board-2 arm, and loc_0c92 is entered on this path from loc_0c91
 * — the 0x0702 table's index-10 target, dispatched INSIDE the vblank NMI
 * (dispatchGameState, mask held) while GAME_STATE==3 && GAME_SUBSTATE==10. The other
 * entry to loc_0c92 (handler_0763's tail) forces BOARD=1 and never reaches this arm.
 * So the NMI can never land inside loc_0cdf: it is ATOMIC, and its internal cycle
 * DISTRIBUTION is unobservable — EXCEPT for the two palette-bank HARDWARE writes.
 *
 *   HARDWARE-WRITE CAVEAT (same pattern as loc_0a8a): 0x7D86/0x7D87 are hardware
 *   latches whose WRITE BUS CYCLE (clock()+busOffset) is recorded in the emit.js
 *   --writes trace, a column the RAM+regs gate cannot see. So the collapse is only
 *   PARTIAL: the prologue keeps just enough m.step granularity (20t before the LO
 *   write, then 16t before the HI write) to land 0x7D86<-1 at cumulative +27 and
 *   0x7D87<-0 at +43 — the oracle's exact bus cycles. Everything after the second
 *   hardware write is work RAM + a `jp` (no hardware write), so its four charges
 *   (10+7+13+10) collapse to ONE 40t lump. The write-trace test proves both latches
 *   keep their exact bus cycle and that a fully-collapsed prologue would shift them.
 *   The TOTAL is still load-bearing (part of the NMI's cost -> the mainLoop vblank
 *   spin count / PRNG, README §2), so the sum is preserved exactly and the whole-
 *   machine EQUAL confirms it.
 */
export function loc_0cdf(m) {
  const { regs, mem } = m;

  // ld de,0x3b5d (10t) + ld hl,0x7d86 (10t) -- collapsed to one 20t charge so the
  // FIRST palette write lands at cumulative +27 (20 + the `ld (hl),n` busOffset 7).
  regs.de = 0x3b5d; // 50m conveyor layout ptr (live-out, consumed by sub_0da7)
  regs.hl = PALETTE_BANK_LO; // 0x7d86
  m.step(0x0ce5, 20);
  mem.write8(PALETTE_BANK_LO, 0x01, 7); // palette bank bit0 = 1   [HW write @ +27]

  // ld (hl),0x01 (10t) + inc hl (6t) -- 16t, so the SECOND palette write lands at
  // cumulative +43 (36 + busOffset 7). regs.hl <- 0x7d87 models `inc hl` (no flags).
  regs.hl = PALETTE_BANK_HI; // 0x7d87
  m.step(0x0ce8, 16);
  mem.write8(PALETTE_BANK_HI, 0x00, 7); // palette bank bit1 = 0   [HW write @ +43]

  // ld a,0x09 / ld (0x6089),a -- SND_BGM = 9 (50m background tune). Work RAM, so it
  // is NOT in the hardware write-trace and its cycle position is free; placed inside
  // the collapsed tail lump (the final RAM value is 9 either way).
  regs.a = 0x09;
  mem.write8(SND_BGM, regs.a);

  // ld (hl),0x00 (10) + ld a,0x09 (7) + ld (0x6089),a (13) + jp 0x0cc6 (10) = 40t,
  // collapsed (no hardware write in this span). Total 20+16+40 = 76t = the oracle.
  m.step(0x0cc6, 40);
  return m.call(0x0cc6); // tail into the shared board-draw tail (DE live-out)
}

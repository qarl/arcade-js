// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0c92 — hand-optimized rewrite of the translated routine at ROM 0x0C92,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. EVERY callee — 0x0874 (playfield/object clear, already
 * optimized), 0x309f (task enqueue), and the four per-board setup arms 0x0CD4 /
 * 0x0CDF / 0x0CF2 / 0x0D43+0x0CC6 — is reached through `m.call`, the routine
 * registry (games/dkong/routines.js), so each resolves to the oracle or to its
 * own optimized rewrite once one exists, never a copy. Only RAM *names* are
 * imported (from ram.js).
 */

import { BOARD, SND_BGM } from "./ram.js";

// The two-bit palette-bank select latch (ls259.6h at 0x7D86/0x7D87) — a board
// control OUTPUT, not work RAM, so it lives in the dkong board (io.js
// writePaletteBank), not ram.js. loc_0c92 sets bank %10 here (LO<-0, HI<-1); the
// board-4 arm re-writes LO<-1 (bank %11 low bit) and deliberately leaves HI.
const PALETTE_BANK_LO = 0x7d86;

/**
 * loc_0c92 -- BOARD BUILDER: clear the playfield, arm the palette bank + opening
 * task, then dispatch per-board setup. [ROM 0x0C92-0x0CC5; the board-4 fall-
 * through arm runs 0x0CB6-0x0CC5 and tail-jumps loc_0cc6.]
 *
 * Reached two ways, BOTH from INSIDE the vblank NMI via dispatchGameState:
 *   - handler_0763 (0x0776) TAIL-JUMPS here after stamping the attract/fresh-game
 *     baseline BOARD=1 (so the attract demo always builds the 25m arm), and
 *   - loc_0c91 (0x0702 table index 10, in-game GAME_SUBSTATE==10) FALLS THROUGH
 *     here once its SUBSTATE_TIMER gate expires, with BOARD = the real board 1..4.
 *
 * WHAT IT DOES (straight-line prologue, then a data-dependent dispatch):
 *   - call 0x0874: clear the playfield / sprite-shadow buffer + initial object set.
 *   - 0x638C := 0 (engine scratch, unnamed) -- reset board bookkeeping.
 *   - call 0x309f: enqueue the opening task (D=0x05, E=0x01).
 *   - Palette bank %10: PALETTE_BANK_LO(0x7D86)<-0, then 0x7D87<-1. TWO HARDWARE
 *     writes (this is the first 0x7D87<-1 of the whole run -- palette bank becomes 2).
 *   - `ld a,(BOARD)` then a `dec a / jp z` CASCADE (not a jump table): each dec
 *     tests the next value, so the arms are BOARD==1 -> loc_0cd4 (25m girders),
 *     2 -> loc_0cdf (50m conveyor), 3 -> loc_0cf2 (75m elevator), and the
 *     fall-through (anything else, in practice 4) -> the inline 100m rivet arm,
 *     which clears a sprite row (call 0x0d43), writes PALETTE_BANK_LO<-1 (a THIRD
 *     hardware write, leaving 0x7D87 as-is), sets SND_BGM(0x6089)<-0x0B, points DE
 *     at the rivet layout table 0x3C8B, and tail-jumps into the shared tail loc_0cc6.
 *   Each per-board arm sets SND_BGM to its own tune index (0x08/0x09/0x0A/0x0B) and
 *   DE to its layout table, then converges on loc_0cc6 (walk the table + finish).
 *
 * INPUTS (read):  BOARD (0x6227) selects the arm. OUTPUTS (write): 0x638C:=0; the
 *   palette-bank latches (0x7D86/0x7D87, +0x7D86 again on the rivet arm); SND_BGM
 *   on the taken arm; DE = the arm's layout pointer (live-out to loc_0cc6); plus
 *   everything 0x0874 / 0x309f / the arm + loc_0cc6 write (all via m.call, identical
 *   to the oracle). A ends as BOARD-1 (arms 1..3) or BOARD-3 handed to sub_0d43
 *   (rivet arm), whatever the taken callee then leaves.
 *
 * FLAGS. loc_0c92's callers do not consume its flags (handler_0763 tail-jumps and
 *   ignores the return; loc_0c91 forwards the boolean but branches on nothing). The
 *   per-board callees receive A/F at their entry, so the flag-writers are kept
 *   VERBATIM: `regs.xor(regs.a)` (A=0, its flags) and each `regs.dec8` set F exactly
 *   as the ROM, and the unit gate's whole-register-file+F compare confirms it.
 *
 * ATOMIC -- cycles collapsed per branch, TOTAL preserved, PARTIAL across the
 *   hardware writes.  BOTH call paths dispatch loc_0c92 from INSIDE the vblank NMI
 *   (dispatchGameState holds the NMI mask), so the NMI can never land inside it OR
 *   its callees -- it is atomic on every call path (grep of m.call(0x0c92) finds
 *   exactly handler_0763 and loc_0c91, both NMI-dispatch). So its internal cycle
 *   DISTRIBUTION is free and each executed branch charges its per-instruction
 *   tstate SUM as ONE m.step. The TOTAL stays load-bearing (as part of the NMI's
 *   cost it sets the main-loop vblank-spin count = the PRNG entropy, README §2), so
 *   each branch's sum is preserved exactly; the whole-machine gate (board-1 arm at
 *   attract frame 518) and the per-branch cycle-total tests pin it -- a wrong total
 *   would diverge at SPIN_COUNT (0x6019).
 *
 *   THE COLLAPSE IS ONLY PARTIAL where loc_0c92 makes its OWN hardware writes: the
 *   two prologue palette latches and the rivet arm's 0x7D86<-1 are recorded in the
 *   emit.js --writes trace with a write-bus-cycle column (clock()+busOffset, +7t for
 *   each `ld (hl),n`). The RAM+regs gate can't see that column, so it is proven by a
 *   separate write-trace test; the prologue/rivet arm keep just enough m.step
 *   granularity (10 / 16 / 10 around the two prologue writes; 72 / 10 / 40 around the
 *   rivet write) to land every latch write at the oracle's exact bus cycle. The
 *   task-enqueue and the dec-cascade have no hardware write, so they fold freely.
 */
export function loc_0c92(m) {
  const { regs, mem } = m;

  // call 0x0874 -- clear the playfield / sprite-shadow buffer + initial objects.
  m.push16(0x0c95);
  m.step(0x0874, 17);
  m.call(0x0874);

  // xor a ; ld (0x638C),a=0 ; ld de,0x0501 -- reset board bookkeeping, stage task.
  regs.xor(regs.a); // A = 0, flags per `xor a`
  mem.write8(0x638c, regs.a); // 0x638C := 0  (engine scratch, unnamed -> hex)
  regs.de = 0x0501;
  m.step(0x0c9c, 27); // xor a(4) + ld(0x638c),a(13) + ld de(10) = 27t

  // call 0x309f -- enqueue the opening task (D=0x05, E=0x01).
  m.push16(0x0c9f);
  m.step(0x309f, 17);
  m.call(0x309f);

  // Palette bank %10: 0x7D86<-0, 0x7D87<-1. Two HARDWARE writes -- per-write
  // granularity so each traces at the oracle's exact bus cycle (partial collapse:
  // ld(hl),0x00 + inc hl fold to one 16t charge between the two writes).
  regs.hl = PALETTE_BANK_LO; // ld hl,0x7d86
  m.step(0x0ca2, 10); // ld hl,0x7d86 (10)
  mem.write8(regs.hl, 0x00, 7); // 0x7D86 := 0  [HW write; palette bank bit0]  @ +7t
  regs.hl = (regs.hl + 1) & 0xffff; // inc hl -> 0x7d87
  m.step(0x0ca5, 16); // ld (hl),0x00 (10) + inc hl (6) = 16t
  mem.write8(regs.hl, 0x01, 7); // 0x7D87 := 1  [HW write; palette bank bit1]  @ +7t
  m.step(0x0ca7, 10); // ld (hl),0x01 (10)

  // ld a,(BOARD) ; dec-cascade dispatch. Atomic + no HW write on the 1/2/3 arms,
  // so each arm's per-instruction sum collapses to one m.step (kept verbatim decs
  // set A/F for the callee). Sums: 13(ld a)+4(dec)+10(jp z) = 27; +10(jp nt)+4(dec)
  // +10(jp z) each further arm = 41, 55.
  regs.a = mem.read8(BOARD); // ld a,(0x6227)
  regs.a = regs.dec8(regs.a); // dec a (board-1 test)
  if (regs.fZ) {
    m.step(0x0cd4, 27);
    return m.call(0x0cd4); // board 1 -- 25m girders
  }
  regs.a = regs.dec8(regs.a); // dec a (board-2 test)
  if (regs.fZ) {
    m.step(0x0cdf, 41);
    return m.call(0x0cdf); // board 2 -- 50m conveyor
  }
  regs.a = regs.dec8(regs.a); // dec a (board-3 test)
  if (regs.fZ) {
    m.step(0x0cf2, 55);
    return m.call(0x0cf2); // board 3 -- 75m elevator
  }

  // Fall-through arm (BOARD not in {1,2,3}; in play == 4) -- 100m rivet setup.
  // The three not-taken jumps + call fold to one charge to the call target (55 +
  // the call's own 17 = 72t); then the arm keeps granularity for its 0x7D86 write.
  m.push16(0x0cb9);
  m.step(0x0d43, 72); // cascade to 0x0cb6 (55) + call 0x0d43 (17)
  m.call(0x0d43); // sub_0d43 -- sprite-row clear
  regs.hl = PALETTE_BANK_LO; // ld hl,0x7d86
  m.step(0x0cbc, 10); // ld hl,0x7d86 (10)
  mem.write8(regs.hl, 0x01, 7); // 0x7D86 := 1  [HW write; leaves 0x7D87 as-is]  @ +7t
  // ld (hl),0x01(10) + ld a,0x0b(7) + ld(SND_BGM),a(13) + ld de(10) = 40t (no HW write)
  regs.a = 0x0b;
  mem.write8(SND_BGM, regs.a); // 0x6089 := 0x0B  -- rivet-board tune/mode index
  regs.de = 0x3c8b; // rivet layout ptr (live-out to loc_0cc6)
  m.step(0x0cc6, 40);
  return m.call(0x0cc6); // shared tail: walk the layout table + finish the build
}

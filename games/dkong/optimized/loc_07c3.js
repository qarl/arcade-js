// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_07c3 — hand-optimized rewrite of the translated routine at ROM 0x07c3,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0874) is reached through `m.call`, the
 * routine registry (games/dkong/routines.js), so it resolves to the oracle or to
 * a future optimized rewrite. Only the RAM name GAME_SUBSTATE is imported (from
 * ram.js).
 */

import { GAME_SUBSTATE } from "./ram.js";

/**
 * loc_07c3 -- game state 1 (attract) sub-state 5: re-init the display, then step
 * the sub-state machine forward.  [ROM 0x07C3-0x07CA]
 *
 *   07c3  cd 74 08     call 0x0874        ; init/fill; takes NO register input
 *   07c6  21 0a 60     ld   hl,0x600a
 *   07c9  34           inc  (hl)          ; advance the 0x600A sub-state -- RMW MEMORY
 *   07ca  c9           ret
 *
 * WHAT IT DOES. Entry index 5 of the game-state-1 sub-state table at ROM 0x0748
 * (dispatched by handler_073c via rst 0x28 while GAME_STATE==1 and 0x6001==0).
 * It (1) calls sub_0874, which clears the playfield tile rows, paints the two
 * side columns and zeroes the 384-byte sprite buffer at 0x6900-0x6A7F (a whole
 * screen re-init that takes NO register input); then (2) increments GAME_SUBSTATE
 * (0x600A) with a flag-correct read-modify-write, advancing the attract sub-state
 * so the NEXT dispatch runs entry 6; then returns.
 *
 * INPUTS. No register inputs. Reads GAME_SUBSTATE (0x600A) for the increment.
 * OUTPUTS. GAME_SUBSTATE := GAME_SUBSTATE+1; sub_0874's screen writes; HL left =
 * 0x600A; flags from `inc (hl)` (S/Z/H/P/V from the new value, N=0, carry
 * preserved). The register file (HL and F included) is left byte-identical to the
 * oracle, which the unit gate compares in full -- so `regs.hl` is assigned and the
 * increment goes through `regs.incMem8`, the same flag-correct RMW the oracle uses.
 *
 * ATOMIC -- YES. loc_07c3 runs INSIDE the vblank NMI (it is an NMI game-state
 * dispatch target, like handler_01c3), so a second NMI cannot land inside it: the
 * handler cleared the NMI mask on entry, and the hardware gate is the mutual
 * exclusion. Its only callee, sub_0874, is a pure memory-fill leaf that makes NO
 * `m.call` to an interruptible routine. So no interrupt is delivered mid-routine
 * and the routine's internal cycle DISTRIBUTION is unobservable -- only its TOTAL
 * reaches the frame's vblank-spin count (README §2).
 *
 * CYCLES -- COLLAPSED to two charges, harness-verified EQUAL whole-machine over
 * 2860 frames (loc_07c3 dispatches once, at attract frame 2852). The `call`'s own
 * 17 T-states stay at the call site because sub_0874 runs (and charges its own
 * cycles) between them and the tail; the straight-line tail `ld hl / inc (hl) /
 * ret` (10+11+10) is collapsed into the single `m.ret(31)`. The TOTAL of each
 * segment is preserved -- stripping it would move the frame's spin count and
 * diverge -- but the per-instruction split within the tail is free because the
 * routine is atomic (verified: full collapse stays EQUAL; see the test's rung
 * note). Same lesson as entry_0611 / handler_05c6, universal per README §2.
 *
 * FLAGS -- KEPT (via incMem8). The routine ends in an unconditional `ret`, so the
 * carry is not a return value, but F is part of the register file the unit gate
 * diffs and nothing here proves a downstream read is absent before AF is popped by
 * the NMI epilogue; the flag-correct RMW is also free, so it is reproduced exactly.
 */
export function loc_07c3(m) {
  const { regs, mem } = m;

  // call 0x0874 -- whole-screen re-init (no register input). Charge the CALL's
  // 17 T-states here: sub_0874 runs and charges its own cycles after it.
  m.push16(0x07c6); // call 0x0874 pushes the return address 0x07C6
  m.step(0x0874, 17);
  m.call(0x0874);

  // ld hl,0x600a / inc (hl) -- advance the attract sub-state (flag-correct RMW).
  regs.hl = GAME_SUBSTATE;
  regs.incMem8(mem, regs.hl);

  // ret -- collapse the atomic tail (ld hl 10 + inc (hl) 11 + ret 10 = 31 T) into
  // one charge; the total is load-bearing (spin count), the distribution is not.
  m.ret(31);
}

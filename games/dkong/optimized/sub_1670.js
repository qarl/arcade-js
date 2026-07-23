// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_1670 — hand-optimized rewrite of the translated routine at ROM 0x1670,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0018 / 0x004E / 0x0030 / 0x0038) is
 * reached through `m.call(0xADDR)`, the routine registry (games/dkong/routines.js),
 * so each resolves to the oracle — or to that callee's own optimized rewrite once
 * one exists — never a copied implementation here to drift. Only the RAM name
 * SUBSTATE_TIMER is imported (from ram.js).
 */

import { SUBSTATE_TIMER } from "./ram.js";

/**
 * sub_1670 -- one board-advance sub-step, entry 1 of loc_1615's rst-0x28 table.
 * [ROM 0x1670-0x1689]
 *
 * DISPATCH. Runs INSIDE the vblank NMI during board-advance:
 * dispatchGameState(GAME_STATE 0x6005 == 3) -> loc_06fe -> loc_1615
 * (GAME_SUBSTATE 0x600A == 0x16) -> rst 0x28 on the 0x6388 selector via the table
 * at 0x1623 [1654,1670,168a,...] -> this routine when BOARD(0x6227) bit0 is set
 * (odd board) AND selector 0x6388 == 1.
 *
 * WHAT IT DOES. Two prescaler gates bracket the work:
 *
 *   1. rst 0x18 (0x0018) -- a countdown gate on SUBSTATE_TIMER (0x6009). sub_0018
 *      decrements it and returns TRUE only the frame it reaches 0; otherwise it
 *      discards this routine's whole remainder AND its caller's (the two `inc sp`
 *      return-to-caller's-caller skip), so `if (!m.call(0x0018)) return;` mirrors it.
 *   2. Body (only when the timer expired):
 *        - copy 0x28 = 40 bytes from ROM 0x3932 to 0x6908-0x692F (sub_004e; HL is
 *          the implicit source, set here);
 *        - re-arm SUBSTATE_TIMER = 0x20 (a fresh 32-frame wait);
 *        - advance the 0x6388 board selector (inc, so the NEXT board-advance frame
 *          dispatches table entry 2);
 *        - load A = 0x04 for the next gate.
 *   3. rst 0x30 (0x0030) -- a bit-select gate: rotate A(=0x04) right BOARD(0x6227)
 *      times and continue only if the resulting carry is set. With A = 0b100 that is
 *      true exactly when BOARD == 3 (75m); otherwise sub_0030 pops+skips, so
 *      `if (!m.call(0x0030)) return;` mirrors it.
 *   4. Tail (only when BOARD == 3): rst 0x38 (loc_0038 -> sub_003d) adds C = 0x04 to
 *      each of 10 cells from 0x690B, stride 4; then return.
 *
 * INPUTS  (RAM read): 0x6009 (via rst 0x18), 0x6227 (via rst 0x30), 0x6388,
 *   ROM 0x3932.. (copy source), 0x690B.. (rst 0x38 add source).
 * OUTPUTS (RAM written): 0x6908-0x692F (copy), 0x6009 = 0x20, 0x6388 (inc),
 *   0x690B/0F/13/17/1B/1F/23/27/2B/2F += 4 (on the full path).
 *
 * FLAGS / REGISTERS. sub_1670 is a dispatch tail (returns nothing its callers
 * branch on; each rst-skip is a STACK operation, not a return value). Every branch
 * ends in a callee reached via m.call, and that callee sets the final A/HL/BC/DE/IX
 * and F: rst 0x18 on the timer-skip, rst 0x30 on the board-skip, rst 0x38 on the
 * full path. So the whole register file (F included, which the unit gate compares)
 * matches the oracle automatically. The one flag sub_1670 sets itself -- `inc (0x6388)`
 * via regs.inc8 -- is never read before rst 0x30 overwrites it, but is kept verbatim
 * so the WRITTEN VALUE (a RAM output) is exact. The live-in registers each callee
 * consumes are set to the oracle's exact values before the call: HL = 0x3932 for the
 * copy, A = 0x04 for rst 0x30, HL = 0x690B and C = 0x04 for rst 0x38.
 *
 * ATOMIC / CYCLES. sub_1670 is ATOMIC: dispatched from inside the NMI, where the mask
 * is held (entry_0066's first act clears it), so the vblank NMI can never land inside
 * it OR any of its four callees. Its own per-instruction m.step charges therefore
 * collapse to one per call-segment -- A rst-0x18 11t, B (ld hl + call) 27t, C (arm +
 * advance + rst-0x30) 59t, D (ld hl + ld c + rst-0x38) 28t -- each placed immediately
 * before its m.call so every callee still starts at the oracle's exact cumulative
 * cycle, plus the final ret 10t. Each branch's TOTAL is preserved exactly (rst-0x18
 * skip 11, rst-0x30 skip 97, full 135). The total stays load-bearing: as part of the
 * NMI's cost it sets the main-loop vblank-spin count (README §2, PRNG entropy), so a
 * wrong collapsed total (58 not 59 in segment C) diverges downstream -- harness-proven,
 * both directions. sub_1670 makes NO hardware writes (0x6009/0x6388/0x690B are work
 * RAM, no bus-offset), so the collapse has no --writes-trace consequence and there is
 * no write-trace test (same as loc_17b6, unlike loc_0a8a).
 */
export function sub_1670(m) {
  const { regs, mem } = m;

  // Segment A -- rst 0x18: SUBSTATE_TIMER countdown gate. Skip the whole routine
  // (and the caller's remainder) unless the timer expired to 0 this frame. 11t.
  m.push16(0x1671);
  m.step(0x0018, 11);
  if (!m.call(0x0018)) return;

  // Segment B -- copy 40 bytes from ROM 0x3932 to 0x6908-0x692F. HL is the implicit
  // source sub_004e reads. own: ld hl 10 + call 17 = 27t before the call.
  regs.hl = 0x3932;
  m.push16(0x1677);
  m.step(0x004e, 27);
  m.call(0x004e);

  // Segment C -- re-arm the sub-state timer, advance the board selector, set up the
  // rst-0x30 test value. own: 7 + 13 + 10 + 11 + 7 + rst 11 = 59t before rst 0x30.
  regs.a = 0x20;
  mem.write8(SUBSTATE_TIMER, regs.a); // 0x6009 = 0x20 (fresh 32-frame wait)
  regs.hl = 0x6388;
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // inc (0x6388) board selector
  regs.a = 0x04; // rst 0x30 selects bit BOARD(0x6227) of this
  m.push16(0x1683);
  m.step(0x0030, 59);
  if (!m.call(0x0030)) return; // continue only when BOARD == 3 (carry set)

  // Segment D -- rst 0x38: add C(=4) to 10 cells from 0x690B, stride 4.
  // own: ld hl 10 + ld c 7 + rst 11 = 28t before the call.
  regs.hl = 0x690b;
  regs.c = 0x04;
  m.push16(0x1689);
  m.step(0x0038, 28);
  m.call(0x0038);

  m.ret(10);
}

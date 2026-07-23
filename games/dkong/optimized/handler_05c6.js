// SPDX-License-Identifier: GPL-3.0-only
/**
 * handler_05c6 — hand-optimized rewrite of the translated routine at ROM 0x05C6,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Callees are reached through `m.call(0xADDR)` (the routine
 * registry, games/dkong/routines.js), so each resolves to the oracle or to its own
 * optimized rewrite once one exists — never a copy.
 */

import { NotImplemented } from "../../../boards/dkong/io.js";

/**
 * handler_05c6 -- task table entry 2: draw a BCD counter.  [ROM 0x05C6-0x05DF]
 *
 * The task-dispatch payload in A selects one of three 3-byte little-endian BCD
 * scores to render, addressed by its MOST-significant byte (draw_0578 walks
 * three bytes DOWNWARD from there):
 *   0 -> 0x60B4  (P1_SCORE  0x60B2 + 2), rendered by 0x056b (draw_056b)
 *   1 -> 0x60B7  (P2_SCORE  0x60B5 + 2), rendered by 0x056b (draw_056b)
 *   2 -> 0x60BA  (HIGH_SCORE 0x60B8 + 2), rendered by 0x05da (tail_05da) -> draw_0578
 *   3 -> untranslated tail at ROM 0x05E0 (throws; must stay identical)
 * 0x60B4/B7/BA are NOT named in ram.js -- they are the +2 MSB of the named
 * score bases, not fields in their own right -- so they stay hex here.
 *
 * A is left untouched: draw_056b re-reads it (`and a`) to pick the render
 * column, and the renderer overwrites every flag it needs, so no flag set here
 * is observed -- the equivalence harness (which compares F) confirms it.
 *
 * LADDER STATUS -- rung 5 (idiomatic), cycles collapsed to one total charge.
 * THE RUNG-4 EXPERIMENT settled the open question the README §2 caveat left:
 * handler_01c3's cycle charges were observable because the NMI's total cost
 * sets the main-loop spin count -- but is that NMI-specific? handler_05c6 is a
 * MAIN-LOOP routine (dispatched by dispatchTask), so it is the control. Result:
 *   (a) stripping ALL m.step charges DIVERGED at 0x6019 (SPIN_COUNT), frame 6,
 *       65 vs 66 -- the *same address and values* as the NMI case. One cheaper
 *       frame reaches the vblank spin sooner, so the loop spins once more.
 *   (b) charging the executed path's TOTAL in a single m.step stayed EQUAL.
 * So a routine's TOTAL cycle cost is observable through the spin count NO MATTER
 * where it runs; only the internal DISTRIBUTION is free. The charge stays -- but
 * as one total per branch, not one per instruction. (Totals below are the sums
 * of the oracle's per-instruction charges along each branch.)
 */
export function handler_05c6(m) {
  const { regs } = m;
  const payload = regs.a;

  if (payload === 3) {
    // Untranslated: left exactly as the oracle, which throws here.
    m.step(0x05e0, 10);
    throw new NotImplemented("handler_05c6 payload 3 path at ROM 0x05E0");
  }

  if (payload === 2) {
    // HIGH_SCORE: 0x05da (tail_05da) loads 0x60BA itself, so DE need not be set here.
    m.step(0x05da, 68); // ROM 0x05C8..0x05DA path total
    return m.call(0x05da);
  }

  // P1 (0) / P2 (1) score; draw_056b picks its column from A (still == payload).
  regs.de = payload === 0 ? 0x60b4 : 0x60b7;
  m.step(0x056b, payload === 0 ? 58 : 68); // ROM 0x05C8..0x056B path totals
  return m.call(0x056b);
}

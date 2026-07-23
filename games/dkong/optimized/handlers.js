// SPDX-License-Identifier: GPL-3.0-only
/**
 * optimized/ — hand-optimized rewrites of translated/ routines, each proven
 * equal to its oracle by the equivalence harness.
 *
 * `handler_01c3` below is at rung 2/3 of the ladder (named + documented,
 * byte-identical to ../translated/state0.js). See its own docstring for the
 * ladder status and why its cycle charges must stay.
 *
 * Every callee is imported straight from translated/ — all routines there are
 * exported (README §1), so the oracle stays the single implementation of each
 * and there are NO copies here to drift out of sync. Only routines actually
 * being rewritten live in this file.
 */

import { sub_0874, sub_0207, sub_0a53, sub_309f } from "../translated/state0.js";
import { entry_06b8, draw_056b, tail_05da } from "../translated/mainloop.js";
import { NotImplemented } from "../../../boards/dkong/io.js";
import { ATTRACT, LEVEL, LIVES, GAME_STATE, BOARD, GAME_SUBSTATE } from "./ram.js";

// Board control latch, not work RAM — it lives in the dkong board, not ram.js.
const FLIPSCREEN = 0x7d82;

/**
 * handler_01c3 -- game state 0: one-time power-on initialization.  [ROM 0x01C3-0x0206]
 *
 * Runs once. It seeds a known baseline, sets the screen up, queues the opening
 * tasks, and advances GAME_STATE so the *next* NMI dispatches a different
 * handler and this one never runs again.
 *
 * LADDER STATUS — rung 2/3 (named + documented), NOT yet de-scaffolded.
 * The `m.step(addr, tstates)` charges and the `m.push16(retaddr)` before each
 * call are RETAINED deliberately, and this remains behaviourally byte-identical
 * to ../translated/state0.js:
 *   - This routine runs inside the NMI, and the NMI's total cycle cost sets how
 *     long the main loop then spins, which is the PRNG's entropy (see ram.js
 *     SPIN_COUNT / RNG). So the `m.step` charges may be observable here; whether
 *     they can be dropped is a harness question, taken up in the next rung.
 *   - Each callee (sub_0874, entry_06b8, sub_0207, sub_0a53, sub_309f) ends in
 *     its own `ret`, so the matching `m.push16` is the calling convention: drop
 *     it and the callee's `ret` unbalances SP. The push stays.
 * So this rung buys readability (names + structure), not fewer operations.
 */
export function handler_01c3(m) {
  const { regs, mem } = m;

  // Clear the playfield and do the initial object setup.
  m.push16(0x01c6); m.step(0x0874, 17); sub_0874(m);

  // Seed 9 bytes of initial data from ROM 0x01BA into the 0x60B2 region.
  regs.hl = 0x01ba; m.step(0x01c9, 10);
  regs.de = 0x60b2; m.step(0x01cc, 10);
  regs.bc = 0x0009; m.step(0x01cf, 10);
  m.ldir(0x01d1);

  // Baseline: attract on, level 1, one life. (A=1 is also carried into entry_06b8.)
  regs.a = 0x01;               m.step(0x01d3, 7);
  mem.write8(ATTRACT, regs.a); m.step(0x01d6, 13);
  mem.write8(LEVEL, regs.a);   m.step(0x01d9, 13);
  mem.write8(LIVES, regs.a);   m.step(0x01dc, 13);

  m.push16(0x01df); m.step(0x06b8, 17); entry_06b8(m); // draw the lives display, etc.
  m.push16(0x01e2); m.step(0x0207, 17); sub_0207(m);   // unpack DSW0 into the settings block

  // Screen up; advance the top-level state (so this handler runs once); board = 25m.
  regs.a = 0x01;                       m.step(0x01e4, 7);
  mem.write8(FLIPSCREEN, regs.a, 10);  m.step(0x01e7, 13);
  mem.write8(GAME_STATE, regs.a);      m.step(0x01ea, 13); // next NMI dispatches attract
  mem.write8(BOARD, regs.a);           m.step(0x01ed, 13);
  regs.xor(regs.a);                    m.step(0x01ee, 4);  // A = 0
  mem.write8(GAME_SUBSTATE, regs.a);   m.step(0x01f1, 13);

  m.push16(0x01f4); m.step(0x0a53, 17); sub_0a53(m);

  // Queue the three opening tasks (each a 16-bit D,E pair via sub_309f).
  for (const [de, after, next] of [
    [0x0304, 0x01f7, 0x01fa],
    [0x0202, 0x01fd, 0x0200],
    [0x0200, 0x0203, 0x0206],
  ]) {
    regs.de = de;   m.step(after, 10);
    m.push16(next); m.step(0x309f, 17); sub_309f(m);
  }

  m.ret();
}

/**
 * handler_05c6 -- task table entry 2: draw a BCD counter.  [ROM 0x05C6-0x05DF]
 *
 * The task-dispatch payload in A selects one of three 3-byte little-endian BCD
 * scores to render, addressed by its MOST-significant byte (draw_0578 walks
 * three bytes DOWNWARD from there):
 *   0 -> 0x60B4  (P1_SCORE  0x60B2 + 2), rendered by draw_056b
 *   1 -> 0x60B7  (P2_SCORE  0x60B5 + 2), rendered by draw_056b
 *   2 -> 0x60BA  (HIGH_SCORE 0x60B8 + 2), rendered by tail_05da -> draw_0578
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
    // HIGH_SCORE: tail_05da loads 0x60BA itself, so DE need not be set here.
    m.step(0x05da, 68); // ROM 0x05C8..0x05DA path total
    return tail_05da(m);
  }

  // P1 (0) / P2 (1) score; draw_056b picks its column from A (still == payload).
  regs.de = payload === 0 ? 0x60b4 : 0x60b7;
  m.step(0x056b, payload === 0 ? 58 : 68); // ROM 0x05C8..0x056B path totals
  return draw_056b(m);
}

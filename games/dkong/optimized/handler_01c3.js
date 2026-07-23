// SPDX-License-Identifier: GPL-3.0-only
/**
 * handler_01c3 — hand-optimized rewrite of the translated routine at ROM 0x01C3,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee is reached through `m.call(0xADDR)`, which
 * resolves via the routine registry (games/dkong/routines.js) to the oracle — or
 * to that callee's own optimized rewrite once one exists — so there is never a
 * copied implementation here to drift. Only RAM *names* are imported (from ram.js).
 */

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
 *   - Each callee (0x0874, 0x06b8, 0x0207, 0x0a53, 0x309f) ends in its own `ret`,
 *     so the matching `m.push16` is the calling convention: drop it and the
 *     callee's `ret` unbalances SP. The push stays; only the direct invocation
 *     became `m.call`.
 * So this rung buys readability (names + structure), not fewer operations.
 */
export function handler_01c3(m) {
  const { regs, mem } = m;

  // Clear the playfield and do the initial object setup.
  m.push16(0x01c6); m.step(0x0874, 17); m.call(0x0874);

  // Seed 9 bytes of initial data from ROM 0x01BA into the 0x60B2 region.
  regs.hl = 0x01ba; m.step(0x01c9, 10);
  regs.de = 0x60b2; m.step(0x01cc, 10);
  regs.bc = 0x0009; m.step(0x01cf, 10);
  m.ldir(0x01d1);

  // Baseline: attract on, level 1, one life. (A=1 is also carried into 0x06b8.)
  regs.a = 0x01;               m.step(0x01d3, 7);
  mem.write8(ATTRACT, regs.a); m.step(0x01d6, 13);
  mem.write8(LEVEL, regs.a);   m.step(0x01d9, 13);
  mem.write8(LIVES, regs.a);   m.step(0x01dc, 13);

  m.push16(0x01df); m.step(0x06b8, 17); m.call(0x06b8); // draw the lives display, etc.
  m.push16(0x01e2); m.step(0x0207, 17); m.call(0x0207); // unpack DSW0 into the settings block

  // Screen up; advance the top-level state (so this handler runs once); board = 25m.
  regs.a = 0x01;                       m.step(0x01e4, 7);
  mem.write8(FLIPSCREEN, regs.a, 10);  m.step(0x01e7, 13);
  mem.write8(GAME_STATE, regs.a);      m.step(0x01ea, 13); // next NMI dispatches attract
  mem.write8(BOARD, regs.a);           m.step(0x01ed, 13);
  regs.xor(regs.a);                    m.step(0x01ee, 4);  // A = 0
  mem.write8(GAME_SUBSTATE, regs.a);   m.step(0x01f1, 13);

  m.push16(0x01f4); m.step(0x0a53, 17); m.call(0x0a53);

  // Queue the three opening tasks (each a 16-bit D,E pair via 0x309f).
  for (const [de, after, next] of [
    [0x0304, 0x01f7, 0x01fa],
    [0x0202, 0x01fd, 0x0200],
    [0x0200, 0x0203, 0x0206],
  ]) {
    regs.de = de;   m.step(after, 10);
    m.push16(next); m.step(0x309f, 17); m.call(0x309f);
  }

  m.ret();
}

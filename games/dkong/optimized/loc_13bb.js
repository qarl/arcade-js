// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_13bb — hand-optimized rewrite of the translated routine at ROM 0x13BB,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. It is a LEAF (it calls nothing), so there is no `m.call`
 * here at all — only the RAM name GAME_SUBSTATE is imported from ram.js. The
 * flip-screen latch 0x7D82 is a board control output (NOT work RAM), so it is named
 * locally, the way loc_13aa / loc_0a8a name their hardware latches.
 *
 * loc_13bb is the near-twin of loc_13aa (the adjacent table entry, idx 18): both are
 * small state RESETs that end by writing the flip-screen latch. The one structural
 * difference the optimization must respect is that loc_13aa writes the latch FIRST
 * (so its partial collapse keeps a 13t prologue BEFORE the write) whereas loc_13bb
 * writes it LAST (so the partial collapse keeps the whole 47t body BEFORE the write).
 */

import { GAME_SUBSTATE } from "./ram.js";

// Flip-screen latch (ls259.6h, 0x7D82): a board control OUTPUT, not work RAM.
// loc_13bb drives it to a constant 1 (`inc a` from the xor-cleared A), unlike
// loc_13aa which mirrors the DIP into it.
const FLIP_SCREEN = 0x7d82;

/**
 * loc_13bb -- idx 19 of the in-game 0x0702 sub-state table: a small state RESET.
 * [ROM 0x13BB-0x13C9; reached via dispatchGameState (the NMI game-state path)
 * -> loc_06fe while GAME_STATE(0x6005)==3 and GAME_SUBSTATE(0x600A)==0x13. The ROM
 * table at 0x0702 maps index 0x13 -> 0x13BB, verified against maincpu.bin.]
 *
 * WHAT IT DOES. Straight-line, no data-dependent control branch — one path:
 *   - Clear 0x600D = 0 and 0x600E = 0 (`xor a / ld (0x600d),a / ld (0x600e),a`) —
 *     both work RAM, left hex (un-evidenced in ram.js; 0x600D is the score-slot
 *     selector sub_055f keys on, 0x600E the level/screen selector loc_196b reads).
 *     loc_13aa sets this same pair to 1; loc_13bb clears it.
 *   - Clear GAME_SUBSTATE (0x600A) to 0, resetting this dispatcher's own selector
 *     so the NEXT NMI runs sub-state 0 (idx 0 of the 0x0702 table).
 *   - Set the FLIP_SCREEN latch (0x7D82) to 1 (`inc a / ld (0x7d82),a`). This is the
 *     routine's one HARDWARE write. The value is a constant 1, not the DIP.
 *
 * INPUTS: none read from RAM (every stored value is derived from `xor a`/`inc a`).
 * OUTPUTS: 0x600D := 0; 0x600E := 0; GAME_SUBSTATE (0x600A) := 0; the FLIP_SCREEN
 * latch (0x7D82) := 1. Registers on exit: A = 1; HL/BC/DE/IX/IY/SP untouched.
 *
 * FLAGS: nothing downstream consumes loc_13bb's flags — its caller (loc_06fe's
 * rst-0x28 tail via dispatchGameState) makes no `ret cc` and branches on no flag it
 * sets; the routine ends in a plain `ret`. But the unit gate compares the whole
 * register file, F included, so the flag-writers are kept verbatim. The final
 * observable F is `inc a`'s (A 0->1: S/Z/H/PV/N clear, C preserved 0 from the
 * preceding `xor a`) = 0x00, exactly the oracle's. Both `xor a` (A=0, written to
 * 0x600D/0x600E/0x600A) and `inc a` (A=1, written to the latch) are kept for their
 * VALUES too, so A and F both match the oracle.
 *
 * ATOMIC — cycles collapsed, TOTAL preserved (70t: xor a 4 + ld(600d) 13 + ld(600e)
 * 13 + ld(600a) 13 + inc a 4 + ld(7d82) 13 + ret 10). This routine runs INSIDE the
 * vblank NMI (dispatchGameState), which does not re-enter (the handler clears the
 * NMI mask), and it CALLS nothing (a leaf) — so the NMI never lands inside it and
 * its internal cycle distribution is unobservable. The total is still load-bearing
 * (as part of the NMI's cost it sets the main-loop spin count, README §2, SPIN_COUNT),
 * so it is preserved exactly and whole-machine EQUAL confirms it.
 *
 * THE COLLAPSE IS ONLY PARTIAL, deliberately: the `ld (0x7d82),a` is a HARDWARE
 * write, recorded in the emit.js --writes trace with a write-bus-cycle column
 * (= clock()+busOffset). The oracle charges the whole body (47t) BEFORE the write,
 * so it traces at +54t (47 + busOffset 7). A full collapse across it would move the
 * write. The RAM+regs gate cannot see the trace, so it is proven separately by the
 * write-trace test; the body keeps its 47t m.step BEFORE the write to land it at
 * +54t exactly. Everything the write reaches (0x600D/0x600E/0x600A) is work RAM,
 * untraced, so those three stores collapse into that 47t lump with no trace
 * consequence, and the write instruction's own 13t is charged after it.
 */
export function loc_13bb(m) {
  const { regs, mem } = m;

  // xor a -- A = 0. The three work-RAM clears below all store this 0; they are
  // untraced (not hardware), so they fold into the collapsed body charge.
  regs.xor(regs.a); // A = 0
  mem.write8(0x600d, regs.a); // 0x600D = 0
  mem.write8(0x600e, regs.a); // 0x600E = 0
  mem.write8(GAME_SUBSTATE, regs.a); // 0x600A = 0 -- reset this dispatcher's selector

  // inc a -- A = 1 (this sets the final observable F; the value goes to the latch).
  regs.a = regs.inc8(regs.a);

  // Collapsed body charged BEFORE the hardware write so the flip-screen store traces
  // at the oracle's exact bus cycle (+54t = 47 + busOffset 7):
  // xor a 4 + ld(600d) 13 + ld(600e) 13 + ld(600a) 13 + inc a 4 = 47t.
  m.step(0x13c6, 47);

  // ld (0x7d82),a -- set the flip-screen latch to 1.  [HW write @ +54t]
  mem.write8(FLIP_SCREEN, regs.a, 7);

  // ld(7d82) 13t (the write instruction's own cycles, charged after the write).
  m.step(0x13c9, 13);
  m.ret(); // ret (0x13C9) -- 10t; pops loc_13bb's return
}

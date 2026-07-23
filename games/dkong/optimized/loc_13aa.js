// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_13aa — hand-optimized rewrite of the translated routine at ROM 0x13AA,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. It is a LEAF (it calls nothing), so there is no `m.call`
 * here at all — only the RAM names DIP_UPRIGHT and GAME_SUBSTATE are imported from
 * ram.js. The flip-screen latch 0x7D82 is a board control output (NOT work RAM),
 * so it is named locally, the way loc_0a8a names the palette-bank latches.
 */

import { DIP_UPRIGHT, GAME_SUBSTATE } from "./ram.js";

// Flip-screen latch (ls259.6h, 0x7D82): a board control OUTPUT, not work RAM.
// DIP_UPRIGHT (0x6026) is mirrored here so a cocktail cabinet flips the display;
// see ram.js DIP_UPRIGHT ("mirrored to the flip-screen latch 0x7D82").
const FLIP_SCREEN = 0x7d82;

/**
 * loc_13aa -- idx 18 of the in-game 0x0702 sub-state table: a small state RESET.
 * [ROM 0x13AA-0x13BA; reached via dispatchGameState (the NMI game-state path)
 * -> loc_06fe while GAME_STATE(0x6005)==3 and GAME_SUBSTATE(0x600A)==0x12.]
 *
 * WHAT IT DOES. Straight-line, no data-dependent control branch — one path:
 *   - Copy DIP_UPRIGHT (0x6026) to the FLIP_SCREEN latch (0x7D82): a cocktail
 *     cabinet (0) leaves the screen unflipped, upright (1) flips it. (This is the
 *     routine's one HARDWARE write.)
 *   - Clear GAME_SUBSTATE (0x600A) to 0, resetting this dispatcher's own selector
 *     so the NEXT NMI runs sub-state 0 (idx 0 of the 0x0702 table).
 *   - Set 0x600D = 1 and 0x600E = 1 (`ld hl,0x0101 / ld (0x600d),hl`) — both work
 *     RAM, left hex (un-evidenced in ram.js; 0x600D is the score-slot selector
 *     sub_055f keys on, 0x600E the level/screen selector loc_196b reads).
 *
 * INPUTS: DIP_UPRIGHT (0x6026, read once). OUTPUTS: the FLIP_SCREEN latch
 * (0x7D82); GAME_SUBSTATE (0x600A := 0); 0x600D := 1; 0x600E := 1. Registers on
 * exit: A = 0, HL = 0x0101; BC/DE/IX/IY/SP untouched.
 *
 * FLAGS: nothing downstream consumes loc_13aa's flags — its caller (loc_06fe's
 * rst-0x28 tail via dispatchGameState) makes no `ret cc` and branches on no flag
 * it sets. But the unit gate compares the whole register file, F included, so the
 * one flag-writer is kept: `xor a` (A=0 => Z set, S/H/N/C clear, P/V set) is the
 * final observable F; the two stores and `ld hl` after it touch no flags. `xor a`
 * is kept for its VALUE too (0 is written to 0x600A). So both A and F match the
 * oracle exactly.
 *
 * ATOMIC — cycles collapsed to one tail total, TOTAL preserved (79t: ld a 13 +
 * ld(7d82) 13 + xor 4 + ld(600a) 13 + ld hl 10 + ld(600d),hl 16 + ret 10). This
 * routine runs INSIDE the vblank NMI (dispatchGameState), which does not re-enter
 * (the handler clears the NMI mask), and it CALLS nothing — so the NMI never lands
 * inside it and its internal cycle distribution is unobservable. The total is
 * still load-bearing (as part of the NMI's cost it sets the main-loop spin count,
 * README §2, SPIN_COUNT), so it is preserved exactly and whole-machine EQUAL
 * confirms it.
 *
 * THE COLLAPSE IS ONLY PARTIAL, deliberately: the `ld (0x7d82),a` is a HARDWARE
 * write, recorded in the emit.js --writes trace with a write-bus-cycle column
 * (= clock()+busOffset). The oracle charges the first instruction (13t) BEFORE the
 * write, so it traces at +20t (13 + busOffset 7). Collapsing across it would move
 * the write to +7t. The RAM+regs gate cannot see the trace, so it is proven
 * separately by the write-trace test; the prologue keeps just the one 13t m.step
 * before the write to land it at +20t exactly. Everything after the write is work
 * RAM only (0x600A/0x600D/0x600E), so it collapses with no trace consequence.
 */
export function loc_13aa(m) {
  const { regs, mem } = m;

  // ld a,(0x6026) -- read the upright/cocktail DIP. Charged (13t) BEFORE the
  // hardware write so the flip-screen store traces at the oracle's exact bus
  // cycle (+20t = 13 + busOffset 7).
  regs.a = mem.read8(DIP_UPRIGHT);
  m.step(0x13ad, 13);

  // ld (0x7d82),a -- mirror the DIP to the flip-screen latch.  [HW write @ +20t]
  mem.write8(FLIP_SCREEN, regs.a, 7);

  // xor a -- A = 0 (this sets the final observable F).
  regs.xor(regs.a);
  mem.write8(GAME_SUBSTATE, regs.a); // 0x600A = 0 -- reset this dispatcher's selector
  regs.hl = 0x0101;
  mem.write16(0x600d, regs.hl); // 0x600D = 1, 0x600E = 1

  // Collapsed tail (atomic, no hardware write past the latch above):
  // ld(7d82) 13 + xor a 4 + ld(600a) 13 + ld hl 10 + ld(600d),hl 16 = 56t.
  m.step(0x13ba, 56);
  m.ret(); // ret (0x13BA) -- 10t; pops loc_13aa's return
}

// SPDX-License-Identifier: GPL-3.0-only
/**
 * handler_0779 — hand-optimized rewrite of the translated routine at ROM 0x0779,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x309f, 0x0965, 0x0874, 0x0a53, 0x09ee,
 * 0x07ad) is reached through `m.call(0xADDR)`, the routine registry
 * (games/dkong/routines.js), so each resolves to the oracle — or to its own
 * optimized rewrite once one exists — never a copy. Only RAM *names* are
 * imported (from ram.js); the two palette-bank latches are board control, not
 * work RAM, so they are local consts.
 */

import { SUBSTATE_TIMER, GAME_SUBSTATE, DIP_COINS_FOR_1P } from "./ram.js";

// Palette-bank select latches (ls259 at 0x7D80..0x7D87). Board control, not
// work RAM, so not in ram.js — matches how handler_01c3 keeps FLIPSCREEN local.
// handler_0779 walks HL across the pair with `inc hl`, clearing both to 0.
const PALETTE_BANK_LO = 0x7d86;
const PALETTE_BANK_HI = 0x7d87;

/**
 * handler_0779 -- game state 1 (attract), sub-state 0: build the title/attract
 * screen and arm the next sub-state.  [ROM 0x0779-0x07C2]
 *
 * Reached once from boot: state 0 (handler_01c3) sets GAME_STATE=1 / substate 0,
 * the next NMI dispatches game state 1 (handler_073c), and with no credit that
 * dispatches sub-state 0 here through the rst 0x28 table at 0x0748. Its own last
 * act increments GAME_SUBSTATE (0 -> 1), so it runs EXACTLY ONCE and sub-state 1
 * (handler_0763) runs on the next attract NMI.
 *
 * WHAT IT DOES, in order:
 *   - clears both palette-bank latches (0x7D86, 0x7D87) by walking HL with inc hl;
 *   - enqueues attract-draw tasks 0x031B then 0x031C (payload++, handler nibble 3);
 *   - enqueues the attract string block via sub_0965 (task 0x0400 + 0x0314..0x0319);
 *   - arms the next sub-state: SUBSTATE_TIMER = 2, then GAME_SUBSTATE++ (0 -> 1);
 *   - clears the playfield + does object setup (sub_0874), then the palette/attract
 *     refresh (sub_0a53);
 *   - when 0x600F == 1, draws the extra attract glyphs (shared fragment sub_09ee);
 *   - writes the two coin-requirement digits to the attract screen (sub_07ad,
 *     CALLED then FALLEN INTO — a two-pass loop, see below).
 *
 * INPUTS (RAM read): 0x600F (branch selector — unnamed, left hex), DIP_COINS_FOR_1P
 *   (0x6022) and the byte above it (0x6023, DIP_COINS_FOR_2P) as the 16-bit DE the
 *   coin-digit writer consumes. Reads no incoming registers (its first act is
 *   `ld hl,0x7d86`).
 * OUTPUTS (RAM/latch written): 0x7D86/0x7D87 = 0; SUBSTATE_TIMER (0x6009) = 2;
 *   GAME_SUBSTATE (0x600A) incremented; the task ring (via 0x309f/0x0965); the
 *   attract VRAM (via 0x0874/0x0a53/0x09ee) and the two coin digits at VRAM 0x756C
 *   / 0x756E (via 0x07ad). All registers/flags on return are whatever the final
 *   sub_07ad leaves — see the FLAGS note.
 *
 * NOTABLE IDIOMS:
 *   - PALETTE WALK. The two latch bits are cleared by one `ld (hl),0 / inc hl /
 *     ld (hl),0` pattern, not two absolute stores, so HL is left at 0x7D87 on the
 *     way into sub_0309f (which preserves it via push/pop). Kept faithful.
 *   - CALL-THEN-FALL-INTO at 0x07AA. `call 0x07AD` targets the instruction
 *     immediately after it, so sub_07ad runs once as a subroutine (rets to 0x07AD)
 *     and then AGAIN as straight-line code with the (hl,de) the first pass handed
 *     back — a two-iteration loop with no counter. Modelled as TWO m.call(0x07ad):
 *     the first has a matching m.push16 (its ret balances it); the SECOND has NO
 *     push, so sub_07ad's ret pops the CALLER'S return address — that is how
 *     handler_0779 itself returns (there is no trailing m.ret here).
 *
 * FLAGS / REGISTERS. The caller (the rst 0x28 sub-state dispatch → handler_073c
 * → NMI) consumes no flags from this routine; the unit gate still compares the
 * whole register file incl. F, so correctness is by construction: the LAST thing
 * both this rewrite and the oracle execute is the same m.call(0x07ad) (the oracle
 * sub_07ad), so A, F, and every register on return are identical without this
 * routine setting them. The `cp 0x01` before the sub_09ee branch is kept verbatim
 * (its Z flag is the branch condition and its A/F are overwritten downstream) so
 * the register file entering sub_09ee matches the oracle exactly.
 *
 * LADDER STATUS — rung 5 (idiomatic), cycles collapsed to ONE total per branch.
 * handler_0779 is ATOMIC: it runs INSIDE the vblank NMI, whose handler clears the
 * NMI mask on entry (io.nmiMask := 0), so the NMI cannot re-fire inside it or any
 * callee. And the NMI fires at cycle N·CYCLES_PER_FRAME, right AFTER that frame's
 * boundary capture, then completes in a few thousand cycles — the next boundary
 * is a full frame (50688 t) away, so NO frame boundary is crossed mid-routine and
 * no mid-instruction state sample can observe its internal cycle distribution.
 * So the per-instruction m.step charges collapse to one per executed branch:
 *   - not-taken (0x600F != 1): 192 (prefix) + 10 (call z not taken) + 47 (suffix) = 249 t
 *   - taken     (0x600F == 1): 192 (prefix) + 17 (call z taken)     + 47 (suffix) = 256 t
 * The TOTAL is still load-bearing (it is the NMI's cost, which sets the main-loop
 * spin count = the PRNG entropy, README §2), so it is preserved exactly; only the
 * DISTRIBUTION is dropped. Harness-verified: collapsing stays EQUAL whole-machine
 * AND unit; the callees' own internal m.step charges are untouched (they run via
 * m.call), so only handler_0779's OWN 249/256 t are folded into one charge.
 */
export function handler_0779(m) {
  const { regs, mem } = m;

  // Clear both palette-bank latches (0x7D86, 0x7D87) by walking HL, leaving HL at
  // 0x7D87 for the task calls (sub_309f preserves it). `ld (hl),n` bus offset +7.
  //
  // PARTIAL COLLAPSE across the two tagged hardware writes. Both are ls259.6h latches
  // recorded in the --writes trace at clock()+7; the oracle lands 0x7D86 at +17 and
  // 0x7D87 at +33 (relative to entry), because 10t and then 16t of clock elapse first.
  // Folding the whole branch into ONE late m.step would put both at +7 -- invisible to
  // the RAM+regs gate but a real trace divergence. So charge just those leading
  // instructions here; the 26t (10 + 16) is subtracted from the final branch charge
  // below, keeping each branch TOTAL exact. Proven by the WRITE-TRACE test.
  regs.hl = PALETTE_BANK_LO;
  m.step(0x077c, 10); // ld hl,0x7d86 -> clock +10
  mem.write8(regs.hl, 0x00, 7); // 0x7D86 write bus @ +17
  regs.hl = PALETTE_BANK_HI; // inc hl (16-bit, no flags)
  m.step(0x077f, 16); // ld (hl),0x00 (10) + inc hl (6) -> clock +26
  mem.write8(regs.hl, 0x00, 7); // 0x7D87 write bus @ +33

  // Enqueue attract-draw tasks 0x031B then 0x031C (inc e keeps handler nibble 3,
  // steps the payload). sub_309f reads D,E and preserves HL.
  regs.de = 0x031b;
  m.push16(0x0787);
  m.call(0x309f);
  regs.e = regs.inc8(regs.e); // -> 0x031C
  m.push16(0x078b);
  m.call(0x309f);

  // Enqueue the attract string block (task 0x0400 + six of 0x0314..0x0319).
  m.push16(0x078e);
  m.call(0x0965);

  // Arm the next sub-state: SUBSTATE_TIMER = 2, then GAME_SUBSTATE++ (0 -> 1) so
  // this handler runs exactly once. `ld (hl),n` is +7; `inc (hl)` is +8 (both
  // inert at work RAM, kept faithful).
  regs.hl = SUBSTATE_TIMER; // 0x6009
  mem.write8(regs.hl, 0x02, 7);
  regs.hl = GAME_SUBSTATE; // 0x600A (inc hl)
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)), 8);

  // Playfield clear + object setup, then the palette/attract refresh.
  m.push16(0x0798);
  m.call(0x0874);
  m.push16(0x079b);
  m.call(0x0a53);

  // When 0x600F == 1, draw the extra attract glyphs (shared fragment sub_09ee).
  // cp kept verbatim so A/F entering sub_09ee match the oracle; Z is the branch.
  regs.a = mem.read8(0x600f);
  regs.cp(0x01);
  const drawExtra = regs.fZ;
  if (drawExtra) {
    m.push16(0x07a3);
    m.call(0x09ee);
  }

  // Coin-requirement digits. DE = (DIP_COINS_FOR_1P:DIP_COINS_FOR_2P) little-endian
  // (E from 0x6022, D from 0x6023); HL = the attract-screen coin-digit VRAM cell.
  regs.de = mem.read16(DIP_COINS_FOR_1P); // 0x6022
  regs.hl = 0x756c; // VRAM (attract coin-digit cell)

  // ONE cycle charge for the REST of this executed branch — atomic routine,
  // distribution free, total preserved (see LADDER STATUS). The two leading palette
  // stores (26t) are charged up top so their hardware writes trace correctly, so this
  // is the branch total (249 / 256) MINUS that 26t = 223 / 230. Must precede the
  // calls: the trailing sub_07ad sets the final PC via its own ret, so no m.step may
  // follow it.
  m.step(0x07ad, drawExtra ? 230 : 223);

  // Two-pass sub_07ad: first pass rets to 0x07AD, second re-runs it straight-line
  // and its ret pops the caller's return address — this routine's own return.
  m.push16(0x07ad);
  m.call(0x07ad);
  m.call(0x07ad);
}

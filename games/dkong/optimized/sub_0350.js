// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0350 — hand-optimized rewrite of the translated routine at ROM 0x0350,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x06b8 = entry_06b8, reached by the tail
 * jump) is invoked through `m.call`, the routine registry (games/dkong/routines.js),
 * so it resolves to the oracle or to entry_06b8's own optimized rewrite — never a
 * copied implementation here. Only RAM *names* are imported (from ram.js).
 */

import { BONUS_LIFE_AWARDED, CURRENT_PLAYER, DIP_BONUS_LIFE, LIVES } from "./ram.js";

/**
 * sub_0350 -- the once-per-player EXTRA-LIFE award check.  [ROM 0x0350-0x037E,
 * then TAIL-JUMPS into entry_06b8 @ 0x06b8]
 *
 *   0350  3a 2d 62     ld   a,(0x622d)   ; A = BONUS_LIFE_AWARDED
 *   0353  a7           and  a
 *   0354  c0           ret  nz           ; already granted this player -> done
 *   0355  21 b3 60     ld   hl,0x60b3    ; P1 score, middle BCD pair
 *   0358  3a 0d 60     ld   a,(0x600d)   ; A = CURRENT_PLAYER
 *   035b  a7           and  a
 *   035c  28 03        jr   z,0x0361     ; P1 (0) keeps 0x60b3; P2 falls through
 *   035e  21 b6 60     ld   hl,0x60b6    ; P2 score, middle BCD pair
 *   0361  7e           ld   a,(hl)       ; loc_0361: middle pair (thousands in hi nibble)
 *   0362  e6 f0        and  0xf0
 *   0364  47           ld   b,a
 *   0365  23           inc  hl           ; -> MSB pair (ten-thousands in lo nibble)
 *   0366  7e           ld   a,(hl)
 *   0367  e6 0f        and  0x0f
 *   0369  b0           or   b            ; A = tttt.TTTT  (T=ten-thousands, t=thousands)
 *   036a  0f 0f 0f 0f  rrca x4           ; rotate down 4 -> A = TTTT.tttt (thousands BCD pair)
 *   036e  21 21 60     ld   hl,0x6021    ; DIP_BONUS_LIFE threshold (BCD thousands)
 *   0371  be           cp   (hl)
 *   0372  d8           ret  c            ; score's thousands below threshold -> done
 *   0373  3e 01        ld   a,0x01
 *   0375  32 2d 62     ld   (0x622d),a   ; latch BONUS_LIFE_AWARDED = 1
 *   0378  21 28 62     ld   hl,0x6228
 *   037b  34           inc  (hl)         ; LIVES += 1
 *   037c  c3 b8 06     jp   0x06b8       ; TAIL jump: redraw lives indicator
 *
 * WHAT IT DOES. Runs once per main-loop pass (mainLoop's per-frame work path,
 * ROM 0x02CA). It grants the score-threshold EXTRA LIFE at most once per player:
 *
 *   1. BONUS_LIFE_AWARDED (0x622D) is a one-shot latch. If already set, `ret nz`
 *      does nothing — the life was granted, so never grant it again.
 *   2. Otherwise it reads the up-player's score. Scores are 3-byte little-endian
 *      packed BCD; sub_0350 wants the *thousands* pair. That pair lives split
 *      across two bytes: the THOUSANDS digit is the high nibble of the middle
 *      pair (0x60b3 P1 / 0x60b6 P2), and the TEN-THOUSANDS digit is the low
 *      nibble of the MSB pair (0x60b4 / 0x60b7). It ORs them into one byte
 *      (ten-thousands:thousands) and `rrca` x4 swaps the nibbles to the natural
 *      BCD order (thousands pair = value/1000 in BCD).
 *   3. It compares that against DIP_BONUS_LIFE (0x6021), the threshold in BCD
 *      thousands (7000/10000/15000/20000). Below threshold -> `ret c`, done.
 *   4. At/above threshold: latch 0x622D=1, `inc (LIVES)`, and TAIL-JUMP to
 *      entry_06b8, which redraws the on-screen lives indicator.
 *
 * INPUTS  : RAM 0x622D (BONUS_LIFE_AWARDED), 0x600D (CURRENT_PLAYER), the up
 *           player's score bytes 0x60b3/0x60b4 (P1) or 0x60b6/0x60b7 (P2),
 *           0x6021 (DIP_BONUS_LIFE). The stack (a caller return address to ret to).
 * OUTPUTS : on the award path only — RAM 0x622D := 1 and 0x6228 (LIVES) += 1,
 *           then entry_06b8's effects (lives-indicator VRAM). Register file:
 *           A, B, HL, F, SP, PC on every path. No boolean is returned; the caller
 *           (mainLoop) ignores the value, so the tail jump's result is inert but
 *           `return`ed for hygiene (matches the oracle).
 *
 * The two hex score pointers 0x60b3 / 0x60b6 stay hex on purpose: they are the
 * +1 MIDDLE byte of the named score bases P1_SCORE (0x60B2) / P2_SCORE (0x60B5),
 * not fields in their own right — the same reason handler_05c6 keeps 0x60B4/B7/BA
 * hex. The MSB byte reached by `inc hl` (0x60b4 / 0x60b7) is likewise the score's
 * +2 pair, left implicit in the pointer walk.
 *
 * FLAGS -- KEPT VERBATIM, every operation. The caller does not branch on
 * sub_0350's flags, but this routine is INTERRUPTIBLE (see cycles), so a vblank
 * NMI that lands mid-routine pushes AF into diffed stack RAM — the intermediate
 * F is observable — AND the unit gate compares the whole register file (F, B, HL,
 * A) on return. So `and`, `rrca`, `cp`, `inc8` are kept exactly, and the dead
 * register churn (`ld b,a`, the pointer loads) is preserved: at an interruptible
 * boundary none of it is actually dead.
 *
 * CYCLES -- PER-INSTRUCTION, DELIBERATELY (NOT collapsed). sub_0350 is NOT atomic
 * and its cycle DISTRIBUTION is load-bearing: it is called every frame from the
 * MAIN LOOP (mask enabled, ROM 0x02CA `m.call(0x0350)`), and the vblank NMI lands
 * INSIDE its 0x0350-0x0372 read/compute region heavily in real gameplay (among the
 * most-hit NMI-landing PCs, per the measured landing histogram). Collapsing the
 * per-instruction m.step charges to one per-branch lump would move where the NMI
 * lands and change the PC it pushes into diffed stack RAM — the exact failure
 * mode README §2 warns about and sub_0020 / handler_05e9 preserve against. So the
 * oracle's charge-for-charge distribution is kept; each branch's TOTAL is the
 * oracle's by construction (ret-nz 28 t; P1 ret-c 147 t; P2 ret-c 152 t; award-P1
 * 192 t of prologue before the entry_06b8 tail). Optimization here buys the RAM
 * names, the plain-English contract, and structured control flow — not a collapse.
 *
 * The award path's `jp 0x06b8` is a TAIL jump with NO push16: entry_06b8's own
 * `ret` (or its rst-0x08 skip in attract) returns to sub_0350's caller, not to
 * here. entry_06b8 is reached via `m.call(0x06b8)` so it resolves to the oracle
 * or to its own optimized rewrite; it is left per-instruction because IT is
 * interruptible too.
 */
export function sub_0350(m) {
  const { regs, mem } = m;

  // ld a,(BONUS_LIFE_AWARDED) / and a / ret nz -- once-per-player guard.
  regs.a = mem.read8(BONUS_LIFE_AWARDED);
  m.step(0x0353, 13);
  regs.and(regs.a);
  m.step(0x0354, 4);
  if (regs.fNZ) {
    m.ret(11); // ret nz -- the extra life was already granted this player.
    return;
  }
  m.step(0x0355, 5);

  // Select the up player's score: P1's middle pair 0x60b3, else P2's 0x60b6.
  regs.hl = 0x60b3; // P1_SCORE (0x60B2) + 1 -- the middle BCD pair.
  m.step(0x0358, 10);
  regs.a = mem.read8(CURRENT_PLAYER);
  m.step(0x035b, 13);
  regs.and(regs.a);
  m.step(0x035c, 4);
  if (regs.fZ) {
    m.step(0x0361, 12); // jr z taken -- P1, keep 0x60b3.
  } else {
    m.step(0x035e, 7); // jr z not taken -- P2.
    regs.hl = 0x60b6; // P2_SCORE (0x60B5) + 1.
    m.step(0x0361, 10);
  }

  // loc_0361: pack the score's thousands BCD pair out of two nibbles.
  //   A = (middle & 0xf0) | (MSB & 0x0f) ; then rrca x4 swaps to (TTTT.tttt).
  regs.a = mem.read8(regs.hl); // middle pair -- thousands in the high nibble.
  m.step(0x0362, 7);
  regs.and(0xf0);
  m.step(0x0364, 7);
  regs.b = regs.a;
  m.step(0x0365, 4);
  regs.hl = (regs.hl + 1) & 0xffff; // -> MSB pair (0x60b4 / 0x60b7).
  m.step(0x0366, 6);
  regs.a = mem.read8(regs.hl); // ten-thousands in the low nibble.
  m.step(0x0367, 7);
  regs.and(0x0f);
  m.step(0x0369, 7);
  regs.or(regs.b);
  m.step(0x036a, 4);
  for (const pc of [0x036b, 0x036c, 0x036d, 0x036e]) {
    regs.rrca();
    m.step(pc, 4);
  }

  // cp DIP_BONUS_LIFE / ret c -- below the extra-life threshold: nothing to do.
  regs.hl = DIP_BONUS_LIFE;
  m.step(0x0371, 10);
  regs.cp(mem.read8(regs.hl));
  m.step(0x0372, 7);
  if (regs.fC) {
    m.ret(11); // ret c -- score's thousands pair is below the threshold.
    return;
  }
  m.step(0x0373, 5);

  // Award: latch the one-shot flag, bump lives, tail-jump to redraw the display.
  regs.a = 0x01;
  m.step(0x0375, 7);
  mem.write8(BONUS_LIFE_AWARDED, regs.a);
  m.step(0x0378, 13);
  regs.hl = LIVES;
  m.step(0x037b, 10);
  mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // inc (LIVES)
  m.step(0x037c, 11);
  // jp 0x06b8 -- TAIL jump: NO push16, so entry_06b8's ret returns to OUR caller.
  // `return` propagates its answer instead of dropping it (hygiene; the caller
  // ignores it, so this is inert today but keeps a future reader honest).
  m.step(0x06b8, 10);
  return m.call(0x06b8);
}

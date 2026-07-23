// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_066a — hand-optimized rewrite of the translated routine at ROM 0x066A,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0689, loc_0689 — the shared write tail)
 * is reached through `m.call`, the routine registry (games/dkong/routines.js), so
 * it resolves to the oracle — or to a future optimized rewrite — never a copy. Only
 * the RAM *name* SND_BGM is imported (from ram.js); the four VRAM tile addresses and
 * the packed-BCD source 0x638C stay hex (see the naming note below).
 */

import { SND_BGM } from "./ram.js";

/**
 * loc_066a -- unpack a packed two-BCD-digit byte and paint it into two VRAM tile
 * cells, suppressing a leading zero. [ROM 0x066A-0x0690; a JOIN reached two ways:
 * fallthrough from 0x0667 (entry_062a's seed pass, branch D) and `jp 0x066a` from
 * 0x06B5 (loc_06a8, entry_062a's BCD-decrement pass, branch B). Both are the
 * MAIN-LOOP task 10 (dispatchTask) — see the ATOMIC note.]
 *
 * WHAT IT DOES. The value V (a packed two-digit BCD number) arrives in A, loaded
 * from 0x638C by the caller. The routine splits V into its two nibbles and draws
 * them as two adjacent digit tiles:
 *   - low nibble (ones)  -> B, written to VRAM 0x74C6 by the tail loc_0689
 *   - high nibble (tens) -> A
 *   HIGH NIBBLE NON-ZERO (branch 1): jump straight to loc_0689 with A = the tens
 *     digit; it writes A to 0x74E6 (tens cell) and B to 0x74C6 (ones cell). This
 *     path makes NO stores of its own — every write is loc_0689's.
 *   HIGH NIBBLE ZERO (branch 2 — LEADING-ZERO SUPPRESSION): instead of drawing a
 *     "0" tens digit, it writes 0x03 to SND_BGM(0x6089), stamps the blank tile 0x70
 *     into 0x7486 and 0x74A6, forms B = 0x70 + low-nibble (a blanked ones glyph),
 *     enters loc_0689 with A = 0x10, so 0x74E6 <- 0x10 and 0x74C6 <- 0x70+low.
 *
 * INPUTS
 *   A          the packed two-digit BCD value V (the caller loads it from 0x638C).
 *              A is the ONLY data-dependent input; nothing else in RAM is read.
 * OUTPUTS
 *   VRAM 0x74E6 / 0x74C6  the two rendered digit tiles (written by the tail loc_0689).
 *   branch 2 additionally writes SND_BGM(0x6089)=0x03 and VRAM 0x7486/0x74A6=0x70.
 *   B          low nibble (branch 1) or 0x70+low (branch 2); C = V throughout;
 *              A ends whatever loc_0689 leaves (= B). All three are compared by the
 *              unit gate, so every one of the oracle's register moves is preserved.
 *
 * NOTABLE IDIOMS (all kept exactly as the oracle behaves them):
 *   - THE FOUR VRAM STORES ARE OUT OF ADDRESS ORDER (0x7486, 0x74A6, then loc_0689's
 *     0x74E6 BEFORE 0x74C6). Final memory is order-independent (all four distinct),
 *     but the write-trace gate is order-sensitive, so the ROM order is preserved.
 *   - HIGH NIBBLE VIA rrca x4 + and 0x0f (nibble swap, then mask). Kept as the Z80
 *     ops rather than a JS `>>4`: rrca and `and` set F, and the unit gate compares F
 *     (the `and 0x0f` at 0x0675 produces the flags branch 1 hands back).
 *   - loc_0689 is the shared TAIL of both arms; it is m.call'd (never inlined) so it
 *     resolves to the oracle (or a future rewrite) at every call site.
 *
 * FLAGS — KEPT VERBATIM. The routine's observable final F is `and 0x0f`'s (branch 1,
 *   high nibble) or `add a,b`'s (branch 2 — the oracle notes 0x0686 "leaves the flags
 *   the 0x0690 ret hands back on this arm"). loc_0689 sets no flags. Both are produced
 *   by the same regs helpers the oracle uses, so the whole register file (F included)
 *   matches; no idiomatic shortcut skips a flag the caller could observe.
 *
 * ATOMIC? NO — PER-INSTRUCTION cycles kept (NOT collapsed). Every m.call(0x066a)
 *   caller is a MAIN-LOOP path (mask enabled): entry_062a (task 10, via its branch-D
 *   tail and via loc_06a8's `jp 0x066a` on branch B). On a main-loop path the vblank
 *   NMI CAN fire mid-routine, and where it lands — and thus the PC it pushes into
 *   diffed stack RAM — depends on this routine's internal cycle distribution. So the
 *   per-instruction m.step charges are load-bearing and are all preserved; collapsing
 *   them would only be provable-safe by a whole-machine run that happened not to be
 *   interrupted here, which is NOT proof (brief's ATOMICITY-IS-PER-CALL-PATH rule).
 *   Per-instruction is unconditionally correct. (The caller entry_062a IS collapsed,
 *   but that is a separate, independently-proven decision about ITS own body; this
 *   leaf stays per-instruction. The optimization win here is names + structure +
 *   documentation, not a cycle collapse and not dropped register churn — every
 *   register move is observed by the unit gate.)
 */
export function loc_066a(m) {
  const { regs, mem } = m;

  // ---- Split V into nibbles. C = V; B = low nibble; A -> high nibble. ----
  regs.c = regs.a; // ld c,a -- keep the original V in C (compared by the unit gate)
  m.step(0x066b, 4);
  regs.and(0x0f); // and 0x0f -- low nibble, sets F
  m.step(0x066d, 7);
  regs.b = regs.a; // ld b,a -- low nibble (ones digit) in B
  m.step(0x066e, 4);
  regs.a = regs.c; // ld a,c -- restore V for the high-nibble extraction
  m.step(0x066f, 4);
  for (const next of [0x0670, 0x0671, 0x0672, 0x0673]) {
    regs.rrca(); // rrca x4 -- rotate V's high nibble down into the low nibble
    m.step(next, 4);
  }
  regs.and(0x0f); // and 0x0f -- high nibble (tens digit) in A; sets the branch-1 F
  m.step(0x0675, 7);

  if (regs.fNZ) {
    // ---- Branch 1: tens digit is non-zero -- draw both digits. ----
    // jp nz,0x0689 -> loc_0689 writes A (tens) to 0x74E6, B (ones) to 0x74C6.
    // This arm makes NO stores of its own; all writes are the tail's.
    m.step(0x0689, 10); // jp nz taken
    return m.call(0x0689);
  }

  // ---- Branch 2: tens digit is zero -- LEADING-ZERO SUPPRESSION. ----
  m.step(0x0678, 10); // jp nz not taken (fall through)

  regs.a = 0x03;
  m.step(0x067a, 7);
  // 0x6089 = SND_BGM per ram.js. A background-tune-index write from a digit
  // renderer is unexpected; the byte IS SND_BGM and the write is faithful to the
  // ROM. Flagged in the equivalence report for a semantic double-check.
  mem.write8(SND_BGM, regs.a); // ld (0x6089),a
  m.step(0x067d, 13);

  regs.a = 0x70; // 0x70 = blank tile
  m.step(0x067f, 7);
  mem.write8(0x7486, regs.a); // VRAM tile cell (blank the leading position)
  m.step(0x0682, 13);
  mem.write8(0x74a6, regs.a); // VRAM tile cell -- out of address order, see doc
  m.step(0x0685, 13);

  regs.add(regs.b); // add a,b -- A = 0x70 + low nibble; produces this arm's final F
  m.step(0x0686, 4);
  regs.b = regs.a; // ld b,a -- the blanked ones glyph, handed to loc_0689 as B
  m.step(0x0687, 4);
  regs.a = 0x10; // ld a,0x10 -- the tens cell (0x74E6) gets 0x10 on this arm
  m.step(0x0689, 7);

  return m.call(0x0689); // fallthrough into loc_0689 (NOT a jump)
}

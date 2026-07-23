// SPDX-License-Identifier: GPL-3.0-only
/**
 * entry_06b8 — hand-optimized rewrite of the translated routine at ROM 0x06B8,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0008, the `rst 0x08` skip helper) is
 * reached through `m.call`, the routine registry (games/dkong/routines.js), so
 * it resolves to the oracle or a future optimized rewrite — never a copy. Only
 * RAM *names* are imported (from ram.js); the VRAM tilemap cells this routine
 * writes are not work RAM and have no ram.js name, so they stay hex.
 */

import { LIVES, LEVEL } from "./ram.js";

/**
 * entry_06b8 -- redraw the lives indicator + the two-digit level number.
 * [ROM 0x06B8-0x06FD]  (task-table entry 6, and a direct callee of handler_01c3
 * and sub_0350's tail-jump). Payload byte arrives in A.
 *
 *   06b8  4f           ld   c,a              ; C = payload (the OLD life count)
 *   06b9  cf           rst  0x08             ; enable gate on ATTRACT bit0 (sub_0008)
 *   06ba  06 06        ld   b,0x06
 *   06bc  11 e0 ff     ld   de,0xffe0        ; -32: step one tilemap ROW back
 *   06bf  21 83 77     ld   hl,0x7783
 *   06c2  36 10        djnz-loop: blank 6 cells to tile 0x10 (the life markers)
 *   06c7  3a 28 62     ld   a,(LIVES)
 *   06ca  91           sub  c                ; how many MORE markers than before?
 *   06cb  ca d7 06     jp   z,0x06d7         ; same count -> leave the field blank
 *   06ce ...           djnz-loop: paint (A) cells to tile 0xFF (a life marker)
 *   06d7  21 03 75 ..  loc_06d7: two fixed tiles (0x1C@0x7503, 0x34@0x74E3)
 *   06e1  3a 29 62     ld   a,(LEVEL) / cp 0x64 / clamp to 0x63 if >= 100
 *   06ed ...           split LEVEL into tens (B) and units (A) by repeated -10
 *   06f6  81 ...       units -> 0x74A3, tens -> 0x74C3 (adjacent columns, 32 apart)
 *   06fd  c9           ret
 *
 * WHAT IT DOES. Redraws the on-screen life indicator and the level number.
 *  - ENABLE GATE (rst 0x08 / sub_0008): if ATTRACT (0x6007) bit0 is SET the
 *    helper discards this routine's return address and returns to OUR caller, so
 *    entry_06b8 does nothing during attract. That skip is surfaced as
 *    `if (!m.call(0x0008)) return true;` (see the `return true` note below).
 *  - LIVES FIELD: blanks six marker cells (tile 0x10), then — if the live count
 *    LIVES (0x6228) exceeds the payload C — paints (LIVES-C) marker cells (0xFF).
 *    Both walk UP the screen by DE=-32 per cell (one 32-column tilemap row).
 *  - LEVEL NUMBER: clamps LEVEL (0x6229) to 0x63 (99) and splits it into two
 *    decimal digits by REPEATED SUBTRACTION of 10, not DAA: B starts 0xFF and
 *    `inc b` runs before the first `sub`, so B ends as the tens digit and the
 *    final `add a,c` restores the units digit that the last borrow overshot.
 *
 * INPUTS  : A (payload, old life count) ; RAM LIVES (0x6228), LEVEL (0x6229),
 *           ATTRACT (0x6007, read by sub_0008).
 * OUTPUTS : VRAM 0x7783..0x76E3 (6 marker cells), 0x7503, 0x74E3, 0x74A3
 *           (units), 0x74C3 (tens); may clamp-write LEVEL (0x6229) to 0x63.
 *           Registers at exit (the unit gate compares the whole file): C=0x0A,
 *           DE=0xFFE0, HL=0x74E3, B=tens, A=tens, F from the final `add a,c`.
 *
 * `return true` IS DELIBERATE, copied from the oracle's reasoning: sub_0008's
 * FALSE means "I skipped MY caller (entry_06b8)", NOT "skip entry_06b8's
 * caller" — so entry_06b8 must NOT propagate that false. It returns TRUE so any
 * future erroneous `if (!entry_06b8(m)) return;` at a call site stays inert. The
 * normal `ret` path also returns true.
 *
 * LADDER STATUS -- rung 4 (idiomatic), cycles collapsed. entry_06b8 is ATOMIC:
 * its only callee, sub_0008, is a non-interruptible leaf (no calls, cannot span
 * a frame), and the routine itself dispatches during frame work well before the
 * vblank spin — so the NMI never lands inside it. Harness-VERIFIED: collapsing
 * the per-instruction m.step charges to one-per-executed-branch (and one per
 * loop ITERATION for the three djnz/subtract loops, whose counts are data-
 * dependent) stays EQUAL whole-machine AND unit, over a window that exercises
 * the SKIP path, the Z path (marker loop skipped), AND the NZ marker loop.
 * The per-branch/iteration TOTALS are preserved exactly (each equals the sum of
 * the oracle's per-instruction charges along that path — the constant blank loop
 * is 199t; the marker loop is 34t/iter, 29t on the last; the split loop 18t/iter;
 * see the inline sums). The TOTAL is still load-bearing (README §2): it is
 * observable through the main-loop spin count, so it is charged, just not once
 * per instruction. Only the internal DISTRIBUTION is free, which is why the
 * intermediate PCs of a collapsed straight-line run need not be materialised.
 */
export function entry_06b8(m) {
  const { regs, mem } = m;

  // ld c,a -- stash the payload (the previous life count) for the sub below.
  regs.c = regs.a;
  m.step(0x06b9, 4);

  // rst 0x08 -- enable gate. sub_0008 returns FALSE when ATTRACT bit0 is set,
  // having discarded our return address, so we return straight to our caller.
  m.push16(0x06ba);
  m.step(0x0008, 11);
  if (!m.call(0x0008)) return true;

  // Blank six life-marker cells to tile 0x10, stepping one tilemap row (-32) up.
  regs.b = 0x06;
  regs.de = 0xffe0;
  regs.hl = 0x7783;
  m.step(0x06c2, 27); // ld b + ld de + ld hl = 7+10+10
  do {
    mem.write8(regs.hl, 0x10);
    regs.addHl(regs.de);
    regs.djnz();
    // ld(hl)+add hl,de+djnz = 10+11+(13 taken | 8 last); 6 iters total = 199t.
    m.step(regs.b !== 0 ? 0x06c2 : 0x06c7, regs.b !== 0 ? 34 : 29);
  } while (regs.b !== 0);

  // a = LIVES - C: the number of extra markers to paint (0 => nothing to draw).
  regs.a = mem.read8(LIVES);
  regs.sub(regs.c);
  m.step(0x06cb, 17); // ld a,(0x6228) + sub c = 13+4

  if (regs.fZ) {
    m.step(0x06d7, 10); // jp z taken -> loc_06d7
  } else {
    // Paint (A) marker cells to tile 0xFF, same -32 row step.
    regs.b = regs.a;
    regs.hl = 0x7783;
    m.step(0x06d2, 24); // jp z not taken + ld b,a + ld hl = 10+4+10
    do {
      mem.write8(regs.hl, 0xff);
      regs.addHl(regs.de);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x06d2 : 0x06d7, regs.b !== 0 ? 34 : 29);
    } while (regs.b !== 0);
  }

  // loc_06d7: two fixed tiles, then load LEVEL and test the clamp threshold.
  // HL is left at 0x74E3 (the unit gate compares it), so both stores go via HL.
  regs.hl = 0x7503;
  mem.write8(regs.hl, 0x1c);
  regs.hl = 0x74e3;
  mem.write8(regs.hl, 0x34);
  regs.a = mem.read8(LEVEL);
  regs.cp(0x64);
  m.step(0x06e6, 60); // ld hl + ld(hl) + ld hl + ld(hl) + ld a,(0x6229) + cp = 10+10+10+10+13+7

  if (regs.fC) {
    m.step(0x06ed, 12); // jr c taken (LEVEL < 100) -> loc_06ed
  } else {
    // Clamp LEVEL to 99 and carry 0x63 into the digit split.
    regs.a = 0x63;
    mem.write8(LEVEL, regs.a);
    m.step(0x06ed, 27); // jr c not taken + ld a,0x63 + ld (0x6229),a = 7+7+13
  }

  // Split A (clamped LEVEL) into tens (B) and units (A) by repeated -10.
  regs.bc = 0xff0a; // B = 0xFF (pre-`inc b`), C = 0x0A (10)
  m.step(0x06f0, 10);
  do {
    regs.b = regs.inc8(regs.b);
    regs.sub(regs.c);
    const again = regs.fNC; // stayed non-negative -> another 10 fits
    // inc b + sub c + jp nc = 4+4+10 = 18t per iteration (jp is 10t either way).
    m.step(again ? 0x06f0 : 0x06f5, 18);
    if (!again) break;
  } while (true);

  regs.add(regs.c); // undo the borrowing subtract -> units digit (sets final F)
  mem.write8(0x74a3, regs.a); // units
  regs.a = regs.b; // ld a,b -- tens digit (no flag effect)
  mem.write8(0x74c3, regs.a); // tens
  m.step(0x06fd, 34); // add a,c + ld(0x74a3) + ld a,b + ld(0x74c3) = 4+13+4+13

  m.ret(); // 06fd: ret (10t)
  return true;
}

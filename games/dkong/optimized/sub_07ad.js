// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_07ad — hand-optimized rewrite of the translated routine at ROM 0x07AD,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. sub_07ad is a LEAF — it calls nothing, so there are no
 * `m.call` callees here. Only RAM *names* would be imported from ram.js, but this
 * routine reads and writes no NAMED work RAM (its inputs arrive in registers and
 * its outputs are video RAM cells), so it imports nothing.
 */

/**
 * sub_07ad -- draw two coin-requirement digits on the attract screen, with a
 * "10" -> "1" + "0" tens-split.  [ROM 0x07AD-0x07C2]
 *
 *   07ad  73           ld   (hl),e      ; write the low digit  (E) to VRAM[HL]
 *   07ae  23           inc  hl
 *   07af  23           inc  hl          ; HL += 2  (tilemap columns are 2 apart)
 *   07b0  72           ld   (hl),d      ; write the high digit (D) to VRAM[HL+2]
 *   07b1  7a           ld   a,d
 *   07b2  d6 0a        sub  0x0a        ; A = D-10, Z iff D == 10  (compare KEEPS result)
 *   07b4  c2 bc 07     jp   nz,0x07bc   ; D != 10: leave the digit as written
 *   07b7  77           ld   (hl),a      ; D == 10: overwrite that cell with 0 (A==0)
 *   07b8  3c           inc  a           ; A = 1
 *   07b9  32 8e 75     ld   (0x758e),a  ; ...and put the carried '1' in the cell left of it
 *   07bc  11 01 02     ld   de,0x0201   ; hand the SECOND pass (E=1,D=2) its arguments
 *   07bf  21 8c 76     ld   hl,0x768c   ; ...and its VRAM cursor
 *   07c2  c9           ret
 *
 * WHAT IT DOES. Places two adjacent tilemap digits: E at VRAM[HL], D at VRAM[HL+2]
 * (the +2 gap is one tilemap column in this rotated layout — two digits side by
 * side, NOT a 16-bit store). `sub 0x0a` is a compare that keeps its difference:
 * when the high digit is exactly 10 the computed 0 is stored in its place (turning
 * a would-be "10" into a literal '0' tile) and a '1' tile is written to the cell
 * two bytes below (0x758E) as the carry — so "10" renders as the two tiles "1 0".
 * Finally it loads DE and HL with the NEXT pass's arguments and returns; it does
 * not preserve them, it HANDS them over — that is the whole mechanism behind
 * handler_0779's call-then-fall-into at 0x07AA, where sub_07ad runs once as a
 * subroutine (rets to 0x07AD) and then AGAIN as straight-line code with the
 * (HL,DE) this routine just handed back. First pass: the coin digits at VRAM
 * 0x756C/0x756E (E=DIP_COINS_FOR_1P, D=DIP_COINS_FOR_2P). Second pass: the fixed
 * "1 2" at VRAM 0x768C/0x768E (E=1, D=2, so D!=10, the tens-split never fires).
 *
 * INPUTS (registers, from the caller): HL = VRAM cursor of the low digit; E = low
 *   digit; D = high digit. Reads NO RAM. OUTPUTS: VRAM[HL] = E, VRAM[HL+2] = D, and
 *   on the D==10 arm VRAM[HL+2] = 0 plus VRAM 0x758E = 1. On return A = D-10 (D!=10)
 *   or 1 (D==10); DE = 0x0201; HL = 0x768C; BC untouched.
 *
 * FLAGS. The caller (handler_0779) does nothing after its final m.call(0x07ad) —
 *   sub_07ad's returned register file IS handler_0779's, and handler_0779's own
 *   caller (the NMI game-state dispatch) consumes no flags. So no flag this routine
 *   sets is branched on downstream. BUT the unit gate compares the whole register
 *   file incl. F, so the flag-writers are kept verbatim: `sub 0x0a` (whose Z is the
 *   branch AND whose result is A on the D!=10 arm) and, on the D==10 arm, `inc a`
 *   (final A=1, final F). Observable F on return therefore matches the oracle exactly
 *   — the `sub` result on the NZ arm, the `inc a` result on the Z arm.
 *
 * ATOMIC — cycles collapsed to ONE total per executed branch, TOTAL preserved.
 *   sub_07ad is a leaf that makes no call, and its ONLY call path is via handler_0779
 *   (grep: the two m.call(0x07ad) at ROM 0x07AA are its only callers), which runs
 *   INSIDE the vblank NMI. The NMI handler clears io.nmiMask on entry, so the NMI
 *   cannot re-fire inside it; and the NMI fires just after a frame boundary and
 *   finishes far short of the next, so no boundary is crossed mid-routine and no
 *   mid-instruction cycle sample can observe the internal distribution. So the
 *   per-instruction m.step charges collapse to one per branch:
 *     - D != 10 (NZ): 37 (prefix) + 10 (jp nz) + 30 (ld de/ld hl/ret) = 77 t
 *     - D == 10 (Z) : 77 + 24 (ld(hl),a 7 + inc a 4 + ld(nn),a 13)     = 101 t
 *   The TOTAL stays load-bearing — as part of the NMI's cost it sets the main-loop
 *   spin count (the PRNG entropy, README §2) — so each branch's sum is preserved
 *   exactly and folded into the closing m.ret(total). Whole-machine EQUAL confirms
 *   it (a wrong total would diverge at SPIN_COUNT 0x6019). There are NO hardware
 *   writes here — every store is video RAM (0x756C/0x756E/0x758E/0x768C-region),
 *   inside the compared state dump but NOT a 0x7Dxx latch — so the collapse has no
 *   write-trace consequence and no write-trace test is needed (cf. loc_0a8a's
 *   video-RAM epilogue).
 */
export function sub_07ad(m) {
  const { regs, mem } = m;

  // ld (hl),e / inc hl / inc hl / ld (hl),d -- two digits, two cells apart.
  mem.write8(regs.hl, regs.e);
  regs.hl = (regs.hl + 2) & 0xffff;
  mem.write8(regs.hl, regs.d);

  // ld a,d / sub 0x0a -- keeps A = D-10; Z set iff the high digit is exactly 10.
  regs.a = regs.d;
  regs.sub(0x0a);

  // jp nz,0x07bc -- NZ leaves the digit as written; Z performs the "10" tens-split.
  let total = 77; // 37 prefix + 10 (jp nz) + 30 (ld de/ld hl/ret)
  if (regs.fZ) {
    mem.write8(regs.hl, regs.a); // A == 0: overwrite the tens cell with a '0' tile
    regs.a = regs.inc8(regs.a); // A = 1
    mem.write8(0x758e, regs.a); // carried '1' tile in the cell left of it (VRAM)
    total = 101; // + 24 (ld(hl),a 7 + inc a 4 + ld(0x758e),a 13)
  }

  // ld de,0x0201 / ld hl,0x768c -- hand the second pass its (E,D) and VRAM cursor.
  regs.de = 0x0201;
  regs.hl = 0x768c;

  // One collapsed charge for the whole executed branch (atomic), then ret: pops
  // the return address the caller pushed (pass 1 -> 0x07AD) or, on pass 2 where no
  // push was made, handler_0779's own return -- exactly the oracle's stack behaviour.
  m.ret(total);
}

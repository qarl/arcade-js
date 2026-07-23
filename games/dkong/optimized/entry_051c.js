// SPDX-License-Identifier: GPL-3.0-only
/**
 * entry_051c — hand-optimized rewrite of the translated routine at ROM 0x051C,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0008, 0x055f, 0x056b, 0x05da) is reached
 * through `m.call(0xADDR)`, which resolves via the routine registry
 * (games/dkong/routines.js) to the oracle — or to that callee's own optimized
 * rewrite once one exists — so there is never a copied implementation here to
 * drift. Only RAM *names* are imported (from ram.js).
 */

import { HIGH_SCORE } from "./ram.js";

/**
 * entry_051c -- task table entry 0: add a 3-byte BCD amount to a score, then
 * challenge the high score.  [ROM 0x051C-0x055C, tail-jumps into 0x05DA]
 *
 *   051c  ld c,a           ; C = task payload (award index)
 *   051d  rst 0x08         ; ENABLE GUARD: skip the whole routine during attract
 *   051e  call 0x055f      ; DE = P1_SCORE (0x60B2) or P2_SCORE (0x60B5)
 *   0521  ld a,c/add a,c*2 ; A = C*3  -> byte offset into the addend table
 *   0525  ld hl,0x3529 ; ld b,0 ; add hl,bc   ; HL -> 3-byte BCD addend
 *   052b  and a            ; CLEAR CARRY for the adc chain (add hl,bc can set it)
 *   052c  ld b,3 ; {ld a,(de); adc a,(hl); daa; ld (de),a; inc de; inc hl} djnz
 *                          ; 3-byte little-endian BCD add, walking UP
 *   0536  push de; dec de; ld a,(0x600d); call 0x056b   ; render the new score
 *   053f  pop de; dec de   ; reposition DE to the score's HIGH byte
 *   0540  ld hl,0x60ba ; ld b,3 ; {ld a,(de); cp (hl); ...} ; compare vs HIGH_SCORE, DOWN
 *   0547  ret c            ; our score is lower -> nothing to do
 *   0548  jp nz,0x0550     ; our score is higher -> copy it over the high score
 *   054f  ret              ; all three bytes equal -> nothing to do
 *   0550  call 0x055f ; ld hl,0x60b8 ; {ld a,(de); ld (hl),a; inc de; inc hl} djnz
 *   055c  jp 0x05da        ; TAIL jump: re-render the (new) high score
 *
 * INPUTS.  A = award index (task payload). RAM read: 0x6007 (ATTRACT, via the
 * rst-0x08 guard), 0x600D (P1/P2 select, via sub_055f), the score triple at
 * P1_SCORE/P2_SCORE, HIGH_SCORE (0x60B8-0x60BA), and the ROM addend table at
 * 0x3529. OUTPUTS.  The selected score triple (BCD-incremented) and, if it now
 * beats HIGH_SCORE, HIGH_SCORE itself; both are then re-drawn to VRAM by the
 * render callees (0x056B and the 0x05DA tail).
 *
 * FOUR IDIOMS FAITHFULLY KEPT (all called out in the oracle header):
 *   - rst 0x08 (sub_0008) is a caller-SKIP: when ATTRACT bit0 is set it discards
 *     its own return and returns to entry_051c's CALLER, so the whole routine is
 *     a no-op during attract. Modelled as `if (!m.call(0x0008)) return;`.
 *   - `and a` at 0x052B exists ONLY for its flag effect (clear carry) so the adc
 *     chain starts clean; kept verbatim as regs.and(regs.a).
 *   - B is carried from the compare loop straight into the copy loop (NOT
 *     reloaded): the copy runs for exactly the bytes the compare had left, so the
 *     compare's remaining count is left in B and the copy loop consumes it.
 *   - the two byte loops run in OPPOSITE directions (add walks UP, compare/copy
 *     walk DOWN), which is why 0x0536-0x053F save/dec DE twice to swing from the
 *     low end to the high end.
 *
 * FLAGS.  The unit gate compares the whole register file incl F, so every
 * flag-producing op is kept verbatim: regs.add (add/adc a,c/(hl)), regs.addHl,
 * regs.and, regs.daa, regs.cp. In particular the terminal flag state IS observed:
 * `ret c` hands back the cp's carry and `ret` (0x054F) hands back the cp's Z, and
 * dispatchTask returns entry_051c's result to the main loop unchanged. djnz sets
 * no flags (regs.djnz decrements B only), so it never disturbs the cp result the
 * ret/jp branch on.
 *
 * LADDER STATUS -- rung 5 (idiomatic), cycles collapsed to one total per segment.
 * Like handler_05c6/entry_0611 this is a MAIN-LOOP routine (dispatched by
 * dispatchTask), so its TOTAL cycle cost is observable (spin count / downstream
 * NMI landing, README §2) but its internal DISTRIBUTION is free. The collapse
 * here is stricter than "one charge per branch": because every callee
 * (sub_0008/sub_055f/draw_056b/tail_05da) is INTERRUPTIBLE, the cumulative cycle
 * count at each m.call must match the oracle exactly, or a downstream NMI would
 * land at a different instruction. So each straight-line run is charged as ONE
 * m.step of its exact per-instruction SUM immediately before the m.call it feeds
 * (or as the m.ret cycles on a terminal branch) -- preserving both each branch's
 * total AND every intermediate call's entry cycle. The constant sums:
 *   guard        ld c,a + rst              = 4+11               = 15   (-> 0x0008)
 *   select       call 0x055f               = 17                        (-> 0x055f)
 *   add+render   pre 55 + BCD loop 145 + post 30 + call 17      = 247  (-> 0x056b)
 *   pre-compare  pop de+dec de+ld hl+ld b  = 10+6+10+7          = 33
 * and the compare/copy per-iteration costs are summed as the loops run (see the
 * inline `cyc`/`cyc2` accumulators), charged once at each exit.
 *
 * VERIFICATION NOTE (honest coverage).  The input-less whole-machine harness only
 * ever reaches the GUARD-SKIP path: attract mode holds ATTRACT bit0 set, so every
 * natural dispatch (first at frame ~1137) returns via sub_0008 without scoring.
 * The skip-path collapse is therefore whole-machine-verified. The scoring paths
 * (the BCD add + high-score compare/copy) are exercised by the unit gate on a
 * synthesised credited-game entry (ATTRACT clear), and additionally whole-machine
 * verified against the oracle under an identical ATTRACT-clear poke on both sides
 * (see equivalence-051c.test.js). All paths preserve their exact per-branch total.
 */
export function entry_051c(m) {
  const { regs, mem } = m;

  // ── ld c,a ; rst 0x08 (enable guard) ────────────────────────────────────────
  regs.c = regs.a; // stash the task payload (award index)
  m.push16(0x051e);
  m.step(0x0008, 15); // ld c,a (4) + rst 0x08 (11)
  if (!m.call(0x0008)) return; // ATTRACT bit0 set: sub_0008 returned to OUR caller

  // ── select the score base into DE ───────────────────────────────────────────
  m.push16(0x0521);
  m.step(0x055f, 17); // call 0x055f
  m.call(0x055f); // DE = P1_SCORE (0x60B2) or P2_SCORE (0x60B5)

  // ── C*3 -> table offset; HL -> the 3-byte BCD addend at 0x3529 ───────────────
  regs.a = regs.c;
  regs.add(regs.c);
  regs.add(regs.c); // A = C*3
  regs.c = regs.a;
  regs.hl = 0x3529; // ROM addend table base
  regs.b = 0x00; // BC = the byte offset
  regs.addHl(regs.bc); // HL -> addend; MAY set carry -> the `and a` below matters
  regs.and(regs.a); // clear carry so the adc chain starts clean

  // ── 3-byte little-endian BCD add, walking UP ────────────────────────────────
  regs.b = 0x03;
  for (let i = 0; i < 3; i++) {
    regs.a = mem.read8(regs.de);
    regs.add(mem.read8(regs.hl), regs.fC ? 1 : 0); // adc a,(hl)
    regs.daa(); // N=0 here (follows adc)
    mem.write8(regs.de, regs.a);
    regs.de = (regs.de + 1) & 0xffff;
    regs.hl = (regs.hl + 1) & 0xffff;
    regs.djnz();
  }

  // ── render the new score (0x056b), preserving DE across the call ────────────
  m.push16(regs.de); // brackets the render CALL (not a loop)
  regs.de = (regs.de - 1) & 0xffff;
  regs.a = mem.read8(0x600d);
  m.push16(0x053e);
  m.step(0x056b, 247); // pre 55 + BCD loop 145 + post 30 + call 17
  m.call(0x056b);

  // ── reposition DE to the HIGH byte; compare down against HIGH_SCORE ──────────
  regs.de = m.pop16();
  regs.de = (regs.de - 1) & 0xffff;
  regs.hl = HIGH_SCORE + 2; // 0x60BA: the high score's MSB, for the downward walk
  regs.b = 0x03;
  let cyc = 33; // pop de(10) + dec de(6) + ld hl(10) + ld b,3(7)

  for (;;) {
    regs.a = mem.read8(regs.de);
    regs.cp(mem.read8(regs.hl));
    cyc += 14; // ld a,(de)(7) + cp (hl)(7)
    if (regs.fC) {
      // ret c: our score is lower -> nothing to do.
      m.ret(cyc + 11);
      return;
    }
    cyc += 5; // ret c not taken (0x0548)
    if (regs.fNZ) {
      // jp nz,0x0550 taken: our score is higher -> go copy it over the high score.
      cyc += 10;
      break;
    }
    cyc += 10; // jp nz not taken (0x054b)
    regs.de = (regs.de - 1) & 0xffff;
    regs.hl = (regs.hl - 1) & 0xffff;
    cyc += 12; // dec de(6) + dec hl(6)
    if (regs.djnz() !== 0) {
      cyc += 13; // djnz taken -> 0x0545
    } else {
      // 0x054f ret: all three bytes equal -> nothing to do.
      cyc += 8; // djnz not taken -> 0x054f
      m.ret(cyc + 10);
      return;
    }
  }

  // ── loc_0550: copy our (higher) score over the high score, B bytes ──────────
  m.push16(0x0553);
  m.step(0x055f, cyc + 17); // segment total (post-render .. the 0x0550 call)
  m.call(0x055f); // does NOT touch B

  regs.hl = HIGH_SCORE; // 0x60B8
  let cyc2 = 10; // ld hl,0x60b8
  do {
    regs.a = mem.read8(regs.de);
    mem.write8(regs.hl, regs.a);
    regs.de = (regs.de + 1) & 0xffff;
    regs.hl = (regs.hl + 1) & 0xffff;
    cyc2 += 26; // ld a,(de)(7) + ld (hl),a(7) + inc de(6) + inc hl(6)
    if (regs.djnz() !== 0) cyc2 += 13; // djnz taken -> 0x0556
    else cyc2 += 8; // djnz not taken -> 0x055c
  } while (regs.b !== 0);

  m.step(0x05da, cyc2 + 10); // ld hl segment + copy loop + jp 0x05da (10)
  return m.call(0x05da); // TAIL jump -- re-render the high score, nothing pushed
}

// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_1732 — hand-optimized rewrite of the translated routine at ROM 0x1732,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x306F) is reached through `m.call`, the
 * routine registry (games/dkong/routines.js), so it resolves to the oracle or to
 * a future optimized rewrite — never a copy. No RAM name is imported: every
 * address this routine touches (0x6913, 0x6900/04/0C, 0x6924, 0x692C, 0x6A21,
 * 0x6388) is un-evidenced in ram.js, so it stays hex here (README §4: name only
 * what can be evidenced; a confidently-wrong name is worse than an honest hex).
 */

/**
 * sub_1732 -- board-advance sub-state guard: HOLD, else RESET-and-advance.
 * [ROM 0x1732-0x1757]
 *
 *   1732  cd 6f 30   call 0x306f        ; per-frame object/RNG housekeeping
 *   1735  3a 13 69   ld   a,(0x6913)    ; A = phase counter
 *   1738  fe 2c      cp   0x2c
 *   173a  d0         ret  nc            ; A >= 0x2C: HOLD (phase still counting)
 *   173b  af         xor  a             ; --- A < 0x2C: reset the object block ---
 *   173c  32 00 69   ld   (0x6900),a    ; 0x6900 = 0
 *   173f  32 04 69   ld   (0x6904),a    ; 0x6904 = 0
 *   1742  32 0c 69   ld   (0x690c),a    ; 0x690c = 0
 *   1745  3e 6b      ld   a,0x6b
 *   1747  32 24 69   ld   (0x6924),a    ; 0x6924 = 0x6B  (seed)
 *   174a  3d         dec  a             ; A = 0x6A
 *   174b  32 2c 69   ld   (0x692c),a    ; 0x692c = 0x6A  (seed-1)
 *   174e  21 21 6a   ld   hl,0x6a21
 *   1751  34         inc  (hl)          ; ++(0x6A21)
 *   1752  21 88 63   ld   hl,0x6388
 *   1755  34         inc  (hl)          ; ++(0x6388)  -- advance the sub-state selector
 *   1756  c9         ret
 *
 * WHAT IT DOES. Dispatched inside the vblank NMI during BOARD-ADVANCE
 * (dispatchGameState GAME_STATE(0x6005)==3 -> loc_06fe -> loc_1615, when
 * GAME_SUBSTATE(0x600A)==0x16, BOARD(0x6227) bit0 set, and selector 0x6388==3 ->
 * rst-0x28 table @0x1623 index 3). It always first calls sub_306f (an
 * every-8th-call RNG/object housekeeper). Then it reads a phase counter at 0x6913
 * and either HOLDs or RESETs:
 *   - A >= 0x2C: HOLD -- return without touching anything (`ret nc`); the phase
 *     is still running.
 *   - A <  0x2C: the phase is done -- zero three object fields (0x6900/04/0C),
 *     seed the 0x6924/0x692C pair to 0x6B/0x6A, bump the 0x6A21 counter, and
 *     advance the 0x6388 sub-state selector so the NEXT frame dispatches the next
 *     arm of this board-advance table.
 *
 * INPUTS: 0x6913 (the branch selector), plus whatever sub_306f reads. OUTPUTS
 * (reset branch only): 0x6900/0x6904/0x690C := 0; 0x6924 := 0x6B; 0x692C := 0x6A;
 * ++0x6A21; ++0x6388. No HARDWARE register is written -- every store is work RAM
 * (no 0x7Dxx latch) -- so the collapse has no --writes-trace consequence and
 * there is no write-trace test.
 *
 * FLAGS / REGISTERS -- load-bearing, NOT dropped (and the unit gate, which
 * compares the whole register file including F, proves it):
 *   - the branch reads F's carry from `cp 0x2c` (carry set iff A < 0x2C).
 *   - on the reset branch the final A is 0x6A and the final F is the word
 *     `inc (0x6388)` leaves. inc/dec PRESERVE carry, so the carry handed back is
 *     the one `xor a` cleared four instructions earlier -- reproduce those ops
 *     out of order and F's carry would be wrong. So the xor/dec/inc chain is kept
 *     verbatim (regs.xor / regs.dec8 / regs.incMem8); the win is elsewhere.
 *
 * LADDER STATUS -- idiomatic, cycles collapsed to one total per branch. sub_1732
 * is ATOMIC: it is dispatched ONLY from inside the NMI (nmi.js dispatchGameState;
 * nothing else m.call's 0x1732), where the NMI mask is held, so the vblank NMI
 * can never land inside it OR inside sub_306f. Its 16 post-call per-instruction
 * m.step charges therefore collapse to one m.ret per branch --
 *   HOLD  13+7+11 = 31 t
 *   RESET 13+7+5 +4 +13+13+13 +7 +13 +4 +13 +10+11 +10+11 +10 = 157 t
 * -- and the whole-machine gate confirms EQUAL. The call charge (17 t) stays
 * BEFORE m.call(0x306f) so the callee still starts at the oracle's exact
 * cumulative cycle. The TOTAL is still load-bearing: as part of the NMI's cost it
 * sets the main-loop vblank-spin count (the PRNG entropy, README §2), so a WRONG
 * collapsed total is caught downstream -- the test proves a 1-cycle error
 * diverges. Preserve each branch's total, free its distribution.
 */
export function sub_1732(m) {
  const { regs, mem } = m;

  // call sub_306f -- per-frame object/RNG housekeeping (every-8th-call body).
  m.push16(0x1735);
  m.step(0x306f, 17);
  m.call(0x306f);

  // ld a,(0x6913) / cp 0x2c -- read the phase counter and test it.
  regs.a = mem.read8(0x6913);
  regs.cp(0x2c);
  if (regs.fNC) {
    // A >= 0x2C: HOLD (ret nc). path total 13+7+11 = 31 t.
    m.ret(31);
    return;
  }

  // A < 0x2C: the phase is done -- reset the object block and advance.
  regs.xor(regs.a);            // A = 0; carry cleared (load-bearing for the final F)
  mem.write8(0x6900, regs.a);  // 0x6900 = 0
  mem.write8(0x6904, regs.a);  // 0x6904 = 0
  mem.write8(0x690c, regs.a);  // 0x690c = 0
  regs.a = 0x6b;
  mem.write8(0x6924, regs.a);  // 0x6924 = 0x6B  (seed)
  regs.a = regs.dec8(regs.a);  // A = 0x6A (dec preserves carry)
  mem.write8(0x692c, regs.a);  // 0x692c = 0x6A  (seed-1)
  regs.hl = 0x6a21;
  regs.incMem8(mem, regs.hl);  // ++(0x6A21)
  regs.hl = 0x6388;
  regs.incMem8(mem, regs.hl);  // ++(0x6388) -- advance the sub-state selector; sets final F

  // ret. path total 13+7+5+4+13+13+13+7+13+4+13+10+11+10+11+10 = 157 t.
  m.ret(157);
}

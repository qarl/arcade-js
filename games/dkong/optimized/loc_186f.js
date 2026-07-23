// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_186f — hand-optimized rewrite of the translated routine at ROM 0x186F,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. BOTH its callees — 0x0018 (the rst 0x18 countdown-skip
 * helper) and 0x004E (the fixed 0x28-byte table copy into 0x6908) — are reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle or to a future optimized rewrite, never a copy. This
 * file imports no RAM names: the only named byte in play, SUBSTATE_TIMER (0x6009),
 * is read+decremented INSIDE sub_0018, not here; loc_186f's own two writes land at
 * 0x6084 (a mid-span SND_TRIGGER latch, kept hex per ram.js — see loc_0b68) and
 * 0x6388 (the "0x6388-sequence" selector, an un-evidenced 0x63xx engine-scratch
 * byte that ram.js rejects, so it stays hex).
 */

/**
 * loc_186f -- 0x6388-sequence step 3 (of the loc_1644 / table-0x1648 cutscene): a
 * SUBSTATE_TIMER-gated 0x28-byte table copy that, when the timer expires, loads a
 * pattern block, arms a sound latch, and advances the selector.
 * [ROM 0x186F-0x187F. Reached via rst 0x28 on (0x6388)==3 through sub_1641, itself
 * dispatched from loc_1615 = the 0x0702 sub-state table index 0x16 (board-advance
 * cutscene) while GAME_STATE(0x6005)==3 and BOARD(0x6227) low 2 bits are clear.
 * Dispatched from INSIDE the vblank NMI (dispatchGameState), so it is ATOMIC.]
 *
 *   186f  df           rst  0x18        ; sub_0018: dec SUBSTATE_TIMER, skip unless it hit 0
 *   1870  21 1f 3a     ld   hl,0x3a1f   ; source of the table copy
 *   1873  cd 4e 00     call 0x004e      ; copy 0x28 bytes 0x3A1F -> 0x6908
 *   1876  3e 03        ld   a,0x03
 *   1878  32 84 60     ld   (0x6084),a  ; arm SND_TRIGGER[4] (3-frame assert)
 *   187b  21 88 63     ld   hl,0x6388
 *   187e  34           inc  (hl)        ; advance the 0x6388-sequence selector
 *   187f  c9           ret
 *
 * WHAT IT DOES. Two branches, keyed on the rst 0x18 substate-timer gate:
 *
 *   A. TIMER STILL TICKING. `rst 0x18` runs sub_0018, which decrements
 *      SUBSTATE_TIMER (0x6009); on a NON-zero result it discards loc_186f's own
 *      return address (two `inc sp`) and returns to loc_186f's CALLER'S caller --
 *      the "skip". The body does not run this frame; only 0x6009 changed. Modelled
 *      by `m.call(0x0018)` returning false, forwarded as an early return (the rst
 *      skip-idiom, same convention as loc_0c91 / handler_0763).
 *
 *   B. TIMER EXPIRED (dec -> 0). sub_0018's `ret z` lands PC at 0x1870, so control
 *      falls through into the body, which:
 *        - ld hl,0x3a1f; call 0x004e -- sub_004e sets DE=0x6908, BC=0x0028 and
 *          block-copies 0x28 bytes from 0x3A1F into the 0x6908 pattern buffer.
 *        - ld a,0x03; ld (0x6084),a -- arm SND_TRIGGER[4] (0x6084) to 3, the
 *          standard 3-frame sound-latch assert (sub_00e0 counts it down).
 *        - ld hl,0x6388; inc (hl) -- advance the 0x6388-sequence selector by 1
 *          (here 3 -> 4), so the next NMI dispatches step 4 (loc_1880).
 *
 * INPUTS.  RAM: SUBSTATE_TIMER (0x6009, read+decremented inside sub_0018); the
 *   return address on the stack (unwound by the skip idiom on branch A); the ROM
 *   table at 0x3A1F (copy source). REGISTERS: none on entry.
 * OUTPUTS. RAM written by THIS routine (branch B only): the 0x6908 pattern buffer
 *   (0x28 bytes, via sub_004e), 0x6084 (SND_TRIGGER[4] = 3), and (0x6388)+1. On
 *   branch A, only sub_0018's write to SUBSTATE_TIMER. NO hardware (0x7Dxx) latch
 *   is written -- every store is work RAM -- so there is no bus-cycle-positioned
 *   write to preserve and no write-trace test is required.
 *
 * FLAGS / REGISTERS. loc_186f sets no flag of its own on branch A (F is whatever
 * sub_0018 leaves: Z clear from the non-zero `dec`). On branch B the final
 * flag-setter is `inc (0x6388)` (kept verbatim as `incMem8`, so S/Z/H/P-V/N match
 * the oracle; C is untouched). A ends at 0x03, HL at 0x6388, DE/BC as sub_004e
 * leaves them (DE=0x6930, BC=0). The rewrite performs the identical register/memory
 * ops, so the unit gate's whole register-file + F + pc compare matches the oracle
 * bit-for-bit. loc_186f returns no value (the oracle ends its body with `ret` and
 * returns undefined); the skip branch returns undefined too -- nothing downstream
 * consumes a return value, so this matches.
 *
 * ATOMIC / CYCLES -- collapsed per branch. loc_186f is dispatched from INSIDE the
 * vblank NMI (nmiMask==0 at every observed dispatch), where the NMI mask is held,
 * so the NMI can never land inside loc_186f OR inside its callees: it is ATOMIC,
 * and its internal cycle DISTRIBUTION is free (README §2). The TAIL (ld a / ld
 * (0x6084),a / ld hl / inc (hl) = 7+13+10+11) is therefore collapsed to one
 * m.step(0x187f, 41) before the `ret`. The rst charge (11 t) and the copy-call
 * charge (17 t) stay at their sites because each precedes an `m.call` (calling
 * convention: the push16 + step pair balances the callee's `ret`); the lone
 * ld hl,0x3a1f (10 t) between them is a single instruction with nothing to fold.
 *
 * The TOTAL is still load-bearing, but its teeth are MEASURED, not assumed. Because
 * loc_186f runs inside the NMI, a wrong total shifts where the NEXT frame's NMI
 * lands in mainLoop and so changes the PC it pushes -- the entry_0611 mechanism:
 * stripping the whole tail diverges the whole-machine trace at STACK 0x6BFE (frame
 * 41), and an ~11 t error diverges at STACK 0x6BF6 (frame 44). But that gate is
 * COARSE: a 1 t error is absorbed by the vblank-spin count's integer slack and does
 * NOT diverge the whole-machine run (measured). So the whole-machine EQUAL run pins
 * branch B's RAM and its total to within ~10 t, and the EXACT per-cycle teeth for
 * BOTH branch totals comes from the branch-coverage test's cycle-total assertion
 * (optimized == oracle, exact): branch B = 89 t of loc_186f's own charges
 * (11 + 10 + 17 + 41 + 10), branch A = just the 11 t rst before the skip.
 *
 * The push16 + m.step pairs before each m.call are the calling convention (the
 * rst's / call's own stack push and cycle cost), NOT scaffolding to drop.
 */
export function loc_186f(m) {
  const { regs, mem } = m;

  // 0x186F rst 0x18 -- SUBSTATE_TIMER gate. sub_0018 decrements SUBSTATE_TIMER
  // (0x6009); UNLESS it hit 0 it unwinds this routine's return address and returns
  // to our caller's caller (the skip). The boolean is the rst skip-idiom.
  m.push16(0x1870); // rst 0x18 pushes its return address = 0x1870
  m.step(0x0018, 11); // rst 0x18 (11 t)
  if (!m.call(0x0018)) return; // timer still ticking -- skip the body this frame

  // Timer expired -- run the body.
  // ld hl,0x3a1f -- source of the 0x28-byte copy sub_004e performs (DE=0x6908).
  regs.hl = 0x3a1f;
  m.step(0x1873, 10); // ld hl,0x3a1f (10 t)

  // call 0x004e -- copy 0x28 bytes 0x3A1F -> 0x6908 (sub_004e sets DE/BC itself).
  m.push16(0x1876); // call 0x004e return address = 0x1876
  m.step(0x004e, 17); // call 0x004e (17 t)
  m.call(0x004e);

  // Tail (collapsed -- atomic, no NMI lands here): ld a,0x03 / ld (0x6084),a /
  // ld hl,0x6388 / inc (hl). 0x6084 = SND_TRIGGER[4] sound latch, armed to 3 (the
  // 3-frame assert idiom, see loc_0b68); inc (0x6388) advances the sequence
  // selector to the next step. Same ops + order as the oracle, so RAM/regs/F match.
  regs.a = 0x03;
  mem.write8(0x6084, regs.a); // ld (0x6084),a -- SND_TRIGGER[4] = 3
  regs.hl = 0x6388;
  regs.incMem8(mem, regs.hl); // inc (0x6388) -- advance the 0x6388-sequence selector
  m.step(0x187f, 41); // tail folded: 7 + 13 + 10 + 11 = 41 t
  m.ret(); // ret (10 t)
}

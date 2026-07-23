// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_03f2 — hand-optimized rewrite of the translated routine at ROM 0x03F2,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. It calls nothing (a leaf), so there are no `m.call`
 * callees here; only the RAM name SPIN_COUNT is imported (from ram.js). The
 * addresses it does NOT name (0x6A29, supplied by the caller in HL) stay hex.
 */

import { SPIN_COUNT } from "./ram.js";

/**
 * sub_03f2 -- conditional double-store of a sprite byte, gated on the spin count.
 * [ROM 0x03F2-0x03FA; the periodic-event tail of sub_03a2, called from BOTH its
 * arms — 0x03CE (B=0x42) and 0x03EC (B=0x40).]
 *
 *   03f2  70           ld  (hl),b        ; store B at (HL)
 *   03f3  3a 19 60     ld  a,(0x6019)    ; A = SPIN_COUNT
 *   03f6  0f           rrca              ; bit 0 of the spin count -> carry
 *   03f7  d8           ret c             ; bit set: leave (HL) = B, done
 *   03f8  04           inc b             ; else B := B+1 ...
 *   03f9  70           ld  (hl),b        ; ... and store AGAIN at the SAME (HL)
 *   03fa  c9           ret
 *
 * WHAT IT DOES. Stores B at (HL), then reads the spin counter and rotates its
 * bit 0 into carry. If that bit is SET it returns immediately, leaving (HL) = B.
 * If it is CLEAR it increments B and stores AGAIN at the SAME address (there is
 * no `inc hl` between the two stores), so (HL) ends B+1. So the low bit of the
 * spin count — a per-frame-jittery pseudo-random value (ram.js SPIN_COUNT) —
 * flips the stored sprite byte between B and B+1 roughly every other frame,
 * which is the flicker/animation this leaf produces at the caller's cell.
 *
 * THE DOUBLE STORE IS DELIBERATE AND KEPT. On the not-taken branch the first
 * store (B) is immediately overwritten by the second (B+1), so it is invisible
 * in FINAL state — but it is a real bus write, visible in the emit `--writes`
 * trace even though the state diff cannot see it (the oracle's own note). Both
 * stores are reproduced verbatim so the write sequence to (HL) is byte-identical
 * to the oracle, not just the final value; the equivalence unit gate confirms the
 * final value and the equivalence-03f2 write-sequence test pins both writes.
 *
 * INPUTS: HL (the target address, 0x6A29 from sub_03a2) and B (0x40 or 0x42 from
 *   sub_03a2), both pre-loaded by the caller; SPIN_COUNT (0x6019). No other RAM
 *   read. OUTPUTS: (HL) — B or B+1; register B (B+1 on the not-taken branch);
 *   A (= the rotated spin count); F (see below). HL is unchanged.
 *
 * FLAGS. No caller consumes sub_03f2's flags directly: sub_03a2's 0x03CE arm
 *   `jp 0x03de`s past any flag test, and its 0x03EC arm recomputes F with a
 *   `dec (hl)` before its next `ret cc`. But F still reaches diffed RAM through
 *   the NMI's `push af`, and the unit gate compares the whole register file, so
 *   `rrca` and `inc8` are kept VERBATIM — the returned F is `rrca`'s on the taken
 *   branch (C = old bit 0, N=H=0, S/Z/PV preserved) and `inc8(B)`'s on the not-
 *   taken branch (C preserved 0 from the rrca). A is likewise kept exact (the
 *   rotated spin count) because it flows out unmodified on the taken arm.
 *
 * ATOMIC? NO — kept PER-INSTRUCTION, not collapsed. sub_03f2 is a leaf reached
 *   ONLY via `m.call(0x03f2)` from sub_03a2, and sub_03a2 is called from the MAIN
 *   LOOP (mainloop.js ROM 0x02E1) with the vblank NMI mask ENABLED. So the NMI can
 *   fall between any two of sub_03f2's instructions; on a frame where it comes due
 *   mid-routine it pushes a 0x03Fx PC into diffed stack RAM. Preserving the
 *   oracle's per-instruction charge distribution keeps that pushed PC identical on
 *   every trajectory. Collapsing to one lump-per-branch total HAPPENS to stay EQUAL
 *   on a 30-frame guard-poke run (the NMI just never landed inside it there) — but
 *   that is precisely the false positive README §2 / the sub_0008 test warn about,
 *   so it is rejected; per-instruction is always correct. The TOTAL is still load-
 *   bearing: stripping the charges diverges the whole-machine trace at SPIN_COUNT
 *   0x6019 (a cheaper frame reaches the vblank spin sooner and reseeds the PRNG),
 *   which the equivalence-03f2 cycle-teeth test pins. Branch totals: 35 t (taken),
 *   50 t (not-taken).
 */
export function sub_03f2(m) {
  const { regs, mem } = m;

  // ld (hl),b -- first store. On the not-taken branch it is overwritten below;
  // it is kept because it is a real bus write (trace-visible, state-invisible).
  mem.write8(regs.hl, regs.b);
  m.step(0x03f3, 7);

  // ld a,(SPIN_COUNT) / rrca -- rotate the spin count's bit 0 into carry.
  regs.a = mem.read8(SPIN_COUNT);
  m.step(0x03f6, 13);
  regs.rrca();
  m.step(0x03f7, 4);

  if (regs.fC) {
    // ret c: bit 0 set -- leave (HL) = B. path total 7+13+4+11 = 35 t.
    m.ret(11);
    return;
  }
  m.step(0x03f8, 5); // ret c not taken

  // inc b / ld (hl),b -- B := B+1, store again at the SAME address ((HL) ends B+1).
  regs.b = regs.inc8(regs.b);
  m.step(0x03f9, 4);
  mem.write8(regs.hl, regs.b);
  m.step(0x03fa, 7);

  m.ret(); // ret (0x03FA) -- 10 t. not-taken path total 7+13+4+5+4+7+10 = 50 t.
}

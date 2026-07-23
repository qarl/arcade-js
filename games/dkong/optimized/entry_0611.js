// SPDX-License-Identifier: GPL-3.0-only
/**
 * entry_0611 — hand-optimized rewrite of the translated routine at ROM 0x0611,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0616) is reached through `m.call`, the
 * routine registry (games/dkong/routines.js), so it resolves to the oracle or to
 * a future optimized rewrite. Only the RAM name ATTRACT is imported (from ram.js).
 */

import { ATTRACT } from "./ram.js";

/**
 * entry_0611 -- task table entry 8: enable-gated string draw + BCD expansion.
 * [ROM 0x0611-0x0615, then falls through into sub_0616 @ 0x0616]
 *
 *   0611  3a 07 60   ld  a,(0x6007)   ; A = ATTRACT
 *   0614  0f         rrca             ; bit 0 of ATTRACT -> carry
 *   0615  d0         ret nc           ; enable bit clear: do nothing
 *   ...  falls through into sub_0616  ; draw string 5 + tail-jump a BCD expand
 *
 * A one-bit ENABLE GUARD on bit 0 of ATTRACT (0x6007): `rrca` rotates that bit
 * into carry, so the routine returns UNLESS it is set -- not a value test but
 * the same `ld a,(0x6007) / rrca / ret nc` idiom sub_0008 uses on the identical
 * byte. When the bit IS set, control falls straight through into 0x0616 (sub_0616),
 * which draws string 5 (via handler_05e9) and tail-jumps a one-byte BCD expansion
 * at 0x6001. 0x0616 is invoked via m.call so it resolves to the oracle (or a future
 * optimized rewrite); it is left per-instruction because it IS interruptible
 * (handler_05e9).
 *
 * A is left rotated and read by nothing downstream (sub_0616's first act reloads
 * A with 0x05); F's carry is the return value on the guard-clear branch and is
 * overwritten by sub_0616 on the fall-through branch. The `rrca` is kept verbatim
 * so BOTH A and F match the oracle exactly -- the unit gate compares the whole
 * register file, F included.
 *
 * LADDER STATUS -- rung 4 (idiomatic), cycles collapsed to one total per branch.
 * entry_0611 is ATOMIC (unlike handler_05e9): charging each branch's per-
 * instruction tstate SUM in a single m.step -- guard-clear 13+4+11 = 28, fall-
 * through 13+4+5 = 22 -- stays EQUAL whole-machine AND unit. The vblank NMI never
 * lands inside this 3-instruction prologue, so its internal cycle distribution is
 * free. The TOTAL is still load-bearing, though: stripping the charges ENTIRELY
 * diverges at stack 0x6bf2 (frame 7, 118 vs 86), because the downstream sub_0616
 * is interruptible -- a cheaper prologue moves where the NMI lands INSIDE it and
 * the pushed PC changes. Preserving each branch's total keeps that landing
 * identical, so: collapse = win, drop = wrong. (Same lesson as handler_05c6, via
 * the stack rather than the spin count -- the mechanism is universal, README §2.)
 */
export function entry_0611(m) {
  const { regs, mem } = m;

  // ld a,(ATTRACT) / rrca -- rotate the enable bit (bit 0) into carry.
  regs.a = mem.read8(ATTRACT);
  regs.rrca();

  if (regs.fNC) {
    // ret nc taken: enable bit clear -- do nothing. path total 13+4+11 = 28 t.
    m.ret(28);
    return;
  }

  // ret nc not taken -- fall through into 0x0616. prologue total 13+4+5 = 22 t.
  m.step(0x0616, 22);
  m.call(0x0616);
}

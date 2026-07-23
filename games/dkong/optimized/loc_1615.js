// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1615 — hand-optimized rewrite of the translated routine at ROM 0x1615,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its three callees (0x30BD, 0x0028, 0x1641) are reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to a future optimized rewrite — never a copy. Only
 * the RAM name BOARD is imported (from ram.js); 0x6388 stays hex because ram.js
 * deliberately leaves it unnamed (0x63xx engine scratch, no re-derived meaning).
 */

import { BOARD } from "./ram.js";

/**
 * loc_1615 -- L2 board-advance sub-state entry: route on BOARD's low two bits.
 * [ROM 0x1615-0x1642; entry 0x16 of loc_06fe's 0x0702 rst-0x28 table, dispatched
 * by dispatchGameState while GAME_STATE(0x6005)==3 and GAME_SUBSTATE(0x600A)==0x16.]
 *
 * WHAT IT DOES. Runs inside the vblank NMI once the board-cleared/advance sub-
 * state (0x16) is active. First it calls sub_30bd (ROM 0x30BD) to clear the
 * sprite scratch block, then it reads BOARD(0x6227) and rotates its bit0/bit1
 * into carry to pick one of three board-advance sub-dispatchers, in EACH case
 * indexed by the 0x6388 sequence byte through a `rst 0x28` inline ROM table:
 *   - BOARD bit0 set              -> rst 0x28 table @0x1623 (6 board arms)
 *   - BOARD bit0 clear, bit1 set  -> rst 0x28 table @0x1637 (5 board arms)
 *   - BOARD bits 0+1 both clear   -> sub_1641 (ROM 0x1641): call 0x1dbd, then its
 *                                    own rst 0x28 table @0x1648 (8 arms) by 0x6388
 * The two `rrca`s are the ROM's `ld a,(0x6227) / rrca / jp c / rrca / jp c` idiom;
 * each dispatched arm reloads A from 0x6388 first (the rst 0x28 index), so the
 * rotated BOARD in A is transient and read by nothing.
 *
 * INPUTS (read): BOARD(0x6227) — its low two bits select the arm; 0x6388 — the
 *   sub-dispatch index (reloaded into A right before each `rst 0x28`; sub_1641
 *   reloads it itself on the fall-through arm). sub_30bd's own inputs are its own.
 * OUTPUTS: no RAM written by loc_1615 itself. A ends = mem[0x6388] on the two
 *   rst arms (the fall-through arm leaves A = BOARD rrca'd twice, which sub_1641
 *   overwrites); the tail callee produces all downstream RAM effects. NO hardware
 *   (0x7Dxx) write anywhere in this routine — so there is no write-bus-cycle trace
 *   at stake and no write-trace test is needed (contrast loc_0a8a).
 *
 * FLAGS. loc_1615 has no `ret cc` of its own — it tail-calls, propagating the
 *   callee's return value (the rst-0x28 skip-propagation convention) unchanged.
 *   The two `rrca`s are kept VERBATIM so both A and F match the oracle exactly at
 *   the hand-off to each callee (the unit gate compares the whole register file,
 *   F included). On the rst arms A is reloaded from 0x6388 (`ld` clears no flag),
 *   so F entering `rst 0x28` is the rrca carry — immediately overwritten by
 *   sub_0028's `add a,a`; on the fall-through arm F is the second rrca's carry
 *   (clear), read by nothing in sub_1641/sub_1dbd (both are flag-neutral `ld`s
 *   into their dispatch). Nothing downstream consumes a flag loc_1615 leaves.
 *
 * ATOMIC — cycles collapsed to one m.step per straight-line segment, TOTAL
 *   preserved. loc_1615 runs INSIDE the vblank NMI (dispatchGameState), which is
 *   non-reentrant (the NMI mask is the guard), so the NMI never lands inside
 *   loc_1615's own instructions and its internal cycle DISTRIBUTION is
 *   unobservable. The per-instruction m.step charges between the sub_30bd call and
 *   the tail dispatch therefore collapse to one charge per branch — bit0 arm
 *   13+4+10+13 = 40t, bit1 arm 13+4+10+4+10+13 = 54t, fall-through arm
 *   13+4+10+4+10 = 41t — each identical to the oracle's per-instruction sum. The
 *   scaffolding charges stay at their own call sites (the `call 0x30bd` 17t and
 *   each `rst 0x28` 11t are part of the calling convention, paired with their
 *   push16/call). The TOTAL is still load-bearing: as part of the NMI's cost it
 *   feeds the main-loop spin count (README §2, SPIN_COUNT), so a wrong total would
 *   diverge whole-machine at 0x6019 — which is exactly what the whole-machine gate
 *   confirms it does not, and the synthesised per-branch cycle-total teeth confirm
 *   arm by arm. (Same collapse decision as loc_18c6, the routine one hop past the
 *   fall-through arm here — proven safe on this identical NMI dispatch path.)
 */
export function loc_1615(m) {
  const { regs, mem } = m;

  // call 0x30bd -- clear the sprite scratch. Its own call boundary: keep the
  // push16/step(17)/call scaffolding (the calling convention, README §2).
  m.push16(0x1618);
  m.step(0x30bd, 17);
  m.call(0x30bd);

  // ld a,(BOARD) / rrca -- rotate BOARD bit0 into carry.
  regs.a = mem.read8(BOARD);
  regs.rrca();

  if (regs.fC) {
    // BOARD bit0 set: dispatch through the 0x1623 board table, indexed by 0x6388.
    regs.a = mem.read8(0x6388); // ld a,(0x6388) -- the rst 0x28 index
    m.step(0x1622, 40); // ld a(0x6227) 13 + rrca 4 + jp 10 + ld a(0x6388) 13
    m.push16(0x1623); // rst 0x28 return addr = the inline table base
    m.step(0x0028, 11); // rst 0x28
    return m.call(0x0028, "0x1623 (0x6388 board sub-dispatch)");
  }

  // bit0 clear: rrca again -- rotate BOARD bit1 into carry.
  regs.rrca();

  if (regs.fC) {
    // BOARD bit1 set: dispatch through the 0x1637 board table, indexed by 0x6388.
    regs.a = mem.read8(0x6388); // ld a,(0x6388) -- the rst 0x28 index
    m.step(0x1636, 54); // ld a 13 + rrca 4 + jp 10 + rrca 4 + jp 10 + ld a 13
    m.push16(0x1637); // rst 0x28 return addr = the inline table base
    m.step(0x0028, 11); // rst 0x28
    return m.call(0x0028, "0x1637 (0x6388 board sub-dispatch)");
  }

  // BOARD bits 0+1 both clear: fall through into sub_1641 (jp, no push).
  m.step(0x1641, 41); // ld a 13 + rrca 4 + jp 10 + rrca 4 + jp 10
  return m.call(0x1641);
}

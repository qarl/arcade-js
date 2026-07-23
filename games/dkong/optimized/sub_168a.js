// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_168a — hand-optimized rewrite of the translated routine at ROM 0x168A,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. All three callees — 0x0018 (the rst 0x18 countdown-skip
 * helper), 0x004E (the fixed 0x28-byte table copy into 0x6908) and 0x1662
 * (tail_1662, the shared board-advance tail) — are reached through `m.call`, the
 * routine registry (games/dkong/routines.js), so each resolves to the oracle or to
 * a future optimized rewrite, never a copy. This file imports no RAM names: the
 * only named byte in play, SUBSTATE_TIMER (0x6009), is read+decremented INSIDE
 * sub_0018, not here; sub_168a's own four writes land at 0x690C, 0x6924, 0x692C
 * (all in the 0x6908 board-object block sub_004e also fills — un-evidenced sprite/
 * object bookkeeping, kept hex per ram.js) and 0x62AF (explicitly rejected as
 * "board-object bookkeeping" in ram.js §Deliberately-unnamed, so it stays hex too).
 */

/**
 * sub_168a -- 0x6388-sequence step 2 (of the loc_1615 board-advance / table-0x1623
 * cutscene): a SUBSTATE_TIMER-gated re-init of the 0x6908 board-object block, then a
 * tail-jump into the shared board-advance tail.
 * [ROM 0x168A-0x16A0. Reached via rst 0x28 on (0x6388)==2 through the table at 0x1623,
 * itself dispatched from loc_1615 = the 0x0702 sub-state table index 0x16 (board-
 * advance cutscene) while GAME_STATE(0x6005)==3 and BOARD(0x6227) bit0 is SET (the
 * `rrca` in loc_1615 routes an odd BOARD to table 0x1623 = [1654,1670,168a,1732,
 * 1757,178e]). Dispatched from INSIDE the vblank NMI (dispatchGameState), so ATOMIC.
 * May also be m.call'd elsewhere; the gates cover it however it is entered.]
 *
 *   168a  df           rst  0x18        ; sub_0018: dec SUBSTATE_TIMER, skip unless it hit 0
 *   168b  21 8c 38     ld   hl,0x388c   ; source of the table copy
 *   168e  cd 4e 00     call 0x004e      ; copy 0x28 bytes 0x388C -> 0x6908
 *   1691  3e 66        ld   a,0x66
 *   1693  32 0c 69     ld   (0x690c),a  ; overwrite copied byte 0x690C with 0x66
 *   1696  af           xor  a           ; A = 0
 *   1697  32 24 69     ld   (0x6924),a  ; clear 0x6924
 *   169a  32 2c 69     ld   (0x692c),a  ; clear 0x692C
 *   169d  32 af 62     ld   (0x62af),a  ; clear 0x62AF
 *   16a0  c3 62 16     jp   0x1662      ; tail_1662: advance 0x6388, rst-0x30 gate, rst 0x38
 *
 * WHAT IT DOES. Two branches, keyed on the rst 0x18 substate-timer gate:
 *
 *   A. TIMER STILL TICKING. `rst 0x18` runs sub_0018, which decrements
 *      SUBSTATE_TIMER (0x6009); on a NON-zero result it discards sub_168a's own
 *      return address (two `inc sp`) and returns to sub_168a's CALLER'S caller --
 *      the "skip". The body does not run this frame; only 0x6009 changed. Modelled
 *      by `m.call(0x0018)` returning false, forwarded as an early return (the rst
 *      skip-idiom, same convention as loc_186f / handler_0763).
 *
 *   B. TIMER EXPIRED (dec -> 0). sub_0018's `ret z` lands PC at 0x168B, so control
 *      falls through into the body, which:
 *        - ld hl,0x388c; call 0x004e -- sub_004e sets DE=0x6908, BC=0x0028 and
 *          block-copies 0x28 bytes from 0x388C into the 0x6908 board-object block.
 *        - ld a,0x66; ld (0x690c),a -- stamp 0x690C (an object-record byte the copy
 *          just filled) back to the fixed 0x66.
 *        - xor a; ld (0x6924),a; ld (0x692c),a; ld (0x62af),a -- clear three
 *          bookkeeping bytes to 0.
 *        - jp 0x1662 -- tail-jump into tail_1662, which advances the 0x6388-sequence
 *          selector (inc (0x6388), here 2 -> 3), runs its own rst-0x30 frame gate,
 *          and a rst 0x38. sub_168a REUSES its frame for the jump (no push16), so
 *          tail_1662's `ret` returns to sub_168a's own caller.
 *
 * INPUTS.  RAM: SUBSTATE_TIMER (0x6009, read+decremented inside sub_0018); the return
 *   address on the stack (unwound by the skip idiom on branch A); the ROM table at
 *   0x388C (copy source). REGISTERS: none on entry.
 * OUTPUTS. RAM written by THIS routine (branch B only): the 0x6908 block (0x28 bytes,
 *   via sub_004e), then 0x690C=0x66, 0x6924=0, 0x692C=0, 0x62AF=0; plus everything
 *   tail_1662 writes (0x6388+1 and the rst-0x38 block). On branch A, only sub_0018's
 *   write to SUBSTATE_TIMER. NO hardware (0x7Dxx) latch is written by sub_168a -- every
 *   store is work RAM -- so there is no bus-cycle-positioned write to preserve and no
 *   write-trace test is required. (sub_004e / tail_1662 are m.call'd; their own writes
 *   are their concern and this routine's collapse never spans them.)
 *
 * FLAGS / REGISTERS. sub_168a sets no flag of its own on branch A (F is whatever
 * sub_0018 leaves: Z clear from the non-zero `dec`). On branch B the last flag-setter
 * before the tail-jump is `xor a` (A=0; S/H/C/N clear, Z/P set = F 0x44), kept verbatim
 * as `regs.xor(regs.a)` -- both for A=0's VALUE (written to 0x6924/0x692C/0x62AF) and so
 * F entering tail_1662 matches the oracle exactly (tail_1662's `inc (0x6388)` preserves
 * carry, so the incoming C=0 is observable). A ends 0x66 then 0, HL at 0x38B4 and DE at
 * 0x6930 / BC 0 as sub_004e leaves them; the tail then overwrites A/HL/F. The rewrite
 * performs the identical register/memory ops in the identical order and tail-jumps the
 * identical 0x1662, so the unit gate's whole register-file + F + pc compare matches the
 * oracle bit-for-bit, and the propagated `return m.call(0x1662)` value matches too.
 *
 * ATOMIC / CYCLES -- collapsed per branch. sub_168a is dispatched from INSIDE the
 * vblank NMI (nmiMask held), where the NMI can never land inside sub_168a OR its
 * callees: it is ATOMIC, and its internal cycle DISTRIBUTION is free (README §2). The
 * EPILOGUE (ld a,0x66 / ld (0x690c) / xor a / ld (0x6924) / ld (0x692c) / ld (0x62af) /
 * jp = 7+13+4+13+13+13+10) is therefore collapsed to one m.step(0x1662, 73) before the
 * tail m.call. The rst charge (11 t) and the copy-call charge (17 t) stay at their sites
 * because each precedes an `m.call` (the push16 + step pair balances the callee's `ret`,
 * calling convention); the lone ld hl,0x388c (10 t) between them is a single instruction
 * with nothing to fold, kept as loc_186f keeps its identical `ld hl` prologue.
 *
 * The TOTAL is still load-bearing (as part of the NMI's cost it sets the main-loop spin
 * count / shifts the next frame's NMI landing -- the entry_0611/loc_186f mechanism), so
 * it is preserved exactly and its EXACT per-cycle teeth come from the branch-coverage
 * test's cycle-total assertion (optimized == oracle): branch B = 111 t of sub_168a's own
 * charges (11 + 10 + 17 + 73), branch A = just the 11 t rst before the skip. Whole-machine
 * EQUAL additionally pins branch B's RAM + coarse total.
 */
export function sub_168a(m) {
  const { regs, mem } = m;

  // 0x168A rst 0x18 -- SUBSTATE_TIMER gate. sub_0018 decrements SUBSTATE_TIMER
  // (0x6009); UNLESS it hit 0 it unwinds this routine's return address and returns
  // to our caller's caller (the skip). The boolean is the rst skip-idiom.
  m.push16(0x168b); // rst 0x18 pushes its return address = 0x168B
  m.step(0x0018, 11); // rst 0x18 (11 t)
  if (!m.call(0x0018)) return; // branch A: timer still ticking -- skip the body this frame

  // Branch B: timer expired -- run the body.
  // ld hl,0x388c -- source of the 0x28-byte copy sub_004e performs (DE=0x6908).
  regs.hl = 0x388c;
  m.step(0x168e, 10); // ld hl,0x388c (10 t)

  // call 0x004e -- copy 0x28 bytes 0x388C -> 0x6908 (sub_004e sets DE/BC itself).
  m.push16(0x1691); // call 0x004e return address = 0x1691
  m.step(0x004e, 17); // call 0x004e (17 t)
  m.call(0x004e);

  // Epilogue (collapsed -- atomic, no NMI lands here): re-stamp 0x690C and clear the
  // three bookkeeping bytes, then tail-jump 0x1662. Same ops + order as the oracle,
  // so RAM/regs/F match. `xor a` kept verbatim for A=0's value AND the F it leaves.
  regs.a = 0x66;
  mem.write8(0x690c, regs.a); // ld (0x690c),a -- object-record byte back to 0x66
  regs.xor(regs.a); // xor a -- A = 0 (and F = 0x44, carried into tail_1662)
  mem.write8(0x6924, regs.a); // clear 0x6924
  mem.write8(0x692c, regs.a); // clear 0x692C
  mem.write8(0x62af, regs.a); // clear 0x62AF
  m.step(0x1662, 73); // epilogue folded: 7 + 13 + 4 + 13 + 13 + 13 + 10 (jp) = 73 t
  return m.call(0x1662); // jp 0x1662 -- tail_1662 (advance 0x6388, rst-0x30 gate, rst 0x38)
}

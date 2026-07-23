// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_06a8 — hand-optimized rewrite of the translated routine at ROM 0x06A8,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x066a) is reached through `m.call` — the
 * routine registry (games/dkong/routines.js) — so it resolves to the oracle
 * (loc_066a) or to a future optimized rewrite; never a copy. No RAM name is
 * imported: both addresses this routine writes are in ram.js's Deliberately-
 * unnamed list. 0x638C is an explicit 0x63xx-scratch REJECT; 0x63B8 has no
 * evidenced name yet (proposed as a naming candidate in this task's report). Both
 * stay hex here, with a comment.
 */

/**
 * loc_06a8 -- BCD-decrement the two-digit render value at 0x638C by one, latch a
 * "reached zero" flag, then repaint the digits.  [ROM 0x06A8-0x06B7, 16 bytes]
 *
 *   06a8  d6 01        sub  0x01          ; A = (0x638C) - 1  (N=1, sets H and C)
 *   06aa  20 05        jr   nz,0x06b1
 *   06ac  21 b8 63     ld   hl,0x63b8
 *   06af  36 01        ld   (hl),0x01     ; the decrement reached 0 -> set latch
 *   06b1  27           daa                ; loc_06b1 -- N=1 (after-subtract) DAA
 *   06b2  32 8c 63     ld   (0x638c),a
 *   06b5  c3 6a 06     jp   0x066a        ; tail into the shared digit painter
 *
 * ENTERED ONLY from entry_062a branch B (`jp nz,0x06a8` at ROM 0x0632), with A
 * already holding (0x638C) and guaranteed non-zero by that caller's guard. It is
 * the per-frame countdown step of the on-screen two-digit BCD value that
 * entry_062a seeds (from BONUS_START/10) and paints: loc_06a8 decrements it one
 * BCD unit and hands the new value to loc_066a to redraw.
 *
 * THE DAA RUNS WITH N=1 (after-subtract DAA) and its inputs (H, N, C) are set NINE
 * BYTES EARLIER by the `sub 0x01`, across the conditional `jr`. On the fall-through
 * arm the `ld hl,nn` / `ld (hl),n` between them write NO flags, so both arms
 * deliver the sub's H/N/C intact. (cpu.js's N=1 DAA branch is pinned against MAME
 * 0.288 -- 2048 cases, 0 mismatches -- see the oracle's note; a `sub` implemented
 * without H yields a wrong VALUE here, not a crash.)
 *
 * INPUTS
 *   A            the current value (0x638C), non-zero (entry_062a's branch-B guard).
 * OUTPUTS
 *   A / (0x638C) the BCD-decremented value (daa of A-1), stored back and passed on
 *                to loc_066a in A.
 *   HL           left = 0x63B8 on the reached-zero arm, untouched otherwise. Nothing
 *                downstream reads it (loc_066a/loc_0689 address VRAM absolutely,
 *                never via HL), but the unit gate diffs the whole register file, so
 *                HL is set VERBATIM to keep that diff clean.
 *   (0x63B8)     set to 1 the frame the countdown underflows to 0 (A was 1). Read
 *                back by entry_062a's `ld a,(0x63b8) / and a / ret nz` guard, whose
 *                early-out then suppresses the divide/re-seed pass -- a "counter
 *                expired" latch (naming candidate in the report; kept hex here).
 *   plus         whatever loc_066a paints (0x6089 + VRAM 0x7486/74A6/74C6/74E6).
 *
 * FLAGS / REGISTERS KEPT VERBATIM. A and F flow through regs.sub / regs.daa exactly
 * as the oracle, and HL is set to 0x63B8 on the zero arm even though nothing reads
 * it -- because the unit gate compares F and HL. There is no dead register churn to
 * drop here: every write is either observed (HL) or load-bearing (A/F feed the daa
 * and then loc_066a). The idiomatic win is names/structure/documentation, not fewer
 * stores.
 *
 * CYCLES -- KEPT PER-INSTRUCTION, NOT collapsed. Atomicity is per-call-path: the
 * ONLY caller is entry_062a branch B, reached via `m.call(0x06a8)`, and entry_062a
 * is a MAIN-LOOP task (dispatched by dispatchTask from mainLoop 0x02BD with the NMI
 * mask ENABLED). So the vblank NMI CAN in principle land between these instructions.
 * Per the project rule, a leaf reached via m.call from an interruptible / main-loop
 * caller keeps its per-instruction charges: a collapse that merely passes a short
 * attract run is not proof the NMI never lands inside on some trajectory, and
 * per-instruction is byte-identical to the oracle's distribution -- unconditionally
 * correct. No hardware-latch (0x7Dxx) write occurs here (only work RAM 0x638C /
 * 0x63B8), so no write-trace test is needed; loc_066a's VRAM stores run in the
 * oracle via m.call.
 *
 * `jp 0x066a` is BACKWARD but NOT a loop -- 0x066A cannot reach 0x06B5, so it is a
 * JOIN into the shared digit-render tail, not a cycle (see the oracle).
 */
export function loc_06a8(m) {
  const { regs, mem } = m;

  // 06a8 `sub 0x01` -- A = (0x638C) - 1; sets N=1 plus H/C, all read by the daa.
  regs.sub(0x01);
  m.step(0x06aa, 7);

  if (regs.fNZ) {
    // 06aa `jr nz,0x06b1` taken -- still above zero, skip the latch.
    m.step(0x06b1, 12);
  } else {
    // fall through: the countdown just underflowed to zero.
    m.step(0x06ac, 7); // jr nz not taken
    regs.hl = 0x63b8; // kept in HL to match the register diff (see header)
    m.step(0x06af, 10); // ld hl,0x63b8 -- writes no flags
    mem.write8(regs.hl, 0x01); // (0x63B8) := 1  -- "counter reached zero" latch
    m.step(0x06b1, 10); // ld (hl),0x01 -- writes no flags
  }

  // 06b1 `daa` -- N=1 after-subtract decimal adjust of A-1 (H/N/C from the sub).
  regs.daa();
  m.step(0x06b2, 4);

  // 06b2 `ld (0x638c),a` -- store the decremented BCD value back.
  mem.write8(0x638c, regs.a);
  m.step(0x06b5, 13);

  // 06b5 `jp 0x066a` -- tail JOIN into the shared two-digit painter (loc_066a).
  m.step(0x066a, 10);
  return m.call(0x066a);
}

// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_12ac — hand-optimized rewrite of the translated routine at ROM 0x12AC,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0018, the `rst 0x18` gate) is reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so it resolves
 * to the oracle — or to a future optimized rewrite — never a copy. Only the RAM
 * name SUBSTATE_TIMER is imported (from ram.js).
 */

import { SUBSTATE_TIMER } from "./ram.js";

/**
 * loc_12ac -- 0x639D dispatch arm 1: blink the two-cell object at 0x694D/0x694E,
 * or advance the 0x639D sub-state.  [ROM 0x12AC-0x12DD, tail at 0x12CB]
 *
 *   12ac  df           rst  0x18          ; gate on SUBSTATE_TIMER (0x6009)
 *   12af  3e 08        ld   a,0x08
 *   12b1  32 09 60     ld   (0x6009),a    ; reload SUBSTATE_TIMER = 8 ticks
 *   12b5  21 9e 63     ld   hl,0x639e
 *   12b6  35           dec  (hl)          ; tick the 0x639E sub-phase counter
 *   12b7  ca cb 12     jp   z,0x12cb      ; 0x639E hit 0 -> advance state (tail)
 *   ... else toggle bit0 of (0x694D) and bit7 of (0x694E), then ret
 *
 * WHAT IT DOES. Reached as table[1] of the 0x639D rst-0x28 dispatch (entry_127f,
 * ROM 0x1283) during the attract sequence. Every 8th tick (the `rst 0x18` gate on
 * SUBSTATE_TIMER) it decrements a phase counter at 0x639E:
 *   - while 0x639E is still counting -> BLINK: XOR bit 0 of (0x694D) and, in
 *     lockstep, bit 7 of (0x694E). The toggle mask is derived by rotating bit 0 of
 *     the CURRENT (0x694D) up into bit 7 (the `ld a,(hl) / rra / ld a,0x02 / rra`
 *     idiom yields B = 0x81 when that bit was set, else 0x01), so B drives BOTH
 *     cells: (0x694D) ^= B, (0x694E) ^= (B & 0x80).
 *   - when 0x639E reaches 0 -> ADVANCE: rewrite (0x694D) to 0x7A/0xFA (its old
 *     bit 7 preserved into bit 7 via `rl (hl) / ld a,0xf4 / rra`), bump the 0x639D
 *     state 1->2, and reload SUBSTATE_TIMER with 0x80 (128 ticks, not 8) so the
 *     next arm runs on a slower cadence.
 *
 * INPUTS  (RAM read):  SUBSTATE_TIMER (0x6009, via the rst-0x18 gate), 0x639E,
 *                      and — on the blink path — 0x694D/0x694E.
 * OUTPUTS (RAM write): SUBSTATE_TIMER (0x6009), 0x639E; blink writes 0x694D+0x694E;
 *                      advance writes 0x694D, 0x639D, and SUBSTATE_TIMER (0x6009).
 *
 * NAMES. Only 0x6009 is evidenced (SUBSTATE_TIMER, ram.js). 0x639D/0x639E are
 * 0x63xx engine scratch and 0x694D/0x694E are used here as a two-cell blinker
 * (NOT Mario's live sprite record), so all stay hex — a wrong name is worse than
 * hex (README §4).
 *
 * REGISTER / FLAG OPS ARE KEPT VERBATIM. The rotate chains (`rra`/`rl`/`rra`) are
 * load-bearing for the CARRY they thread between instructions, and the unit gate
 * compares the whole register file incl. F, A, B, HL and pc — so the regs.* ops
 * are reproduced exactly rather than re-expressed. The only memory op dropped is
 * the WASTED `rl (hl)` store in the advance tail (its value is overwritten one
 * instruction later by the `rra` result); its flag side-effect is kept via the
 * still-executed regs.rl, so RAM + F + regs remain identical (harness-proven).
 *
 * ATOMIC / CYCLES — collapsed to one total per branch. loc_12ac runs INSIDE the
 * NMI handler (dispatchGameState), where the hardware NMI mask is already cleared,
 * so no NMI can fire inside it; and NMI_CYCLE_IN_FRAME=0 puts the handler ~50688
 * cycles from the next frame boundary, so no state-dump capture can land mid-
 * routine either. Its per-instruction m.step distribution is therefore
 * unobservable and is collapsed to a single charge per executed branch (blink 140,
 * advance 145 — the sums of the oracle's per-instruction charges from 0x12AF to
 * the ret). The TOTAL is still load-bearing: the NMI handler's cost sets the
 * main-loop spin count that seeds the PRNG (README §2), so each branch's total is
 * preserved exactly. The `rst 0x18` instruction's own 11t is charged BEFORE the
 * m.call (calling convention), and the gate branch keeps the oracle's early
 * `return`. Harness-verified EQUAL whole-machine + unit across all three branches.
 */
export function loc_12ac(m) {
  const { regs, mem } = m;

  // rst 0x18: tick SUBSTATE_TIMER (0x6009). If it has NOT expired, sub_0018
  // discards our return address and control skips to our caller's caller -- the
  // dispatch is abandoned this frame. 11t is the rst instruction itself.
  m.push16(0x12ad);
  m.step(0x0018, 11);
  if (!m.call(0x0018)) return;

  // Reload SUBSTATE_TIMER = 8, then tick the 0x639E sub-phase counter.
  regs.a = 0x08;
  mem.write8(SUBSTATE_TIMER, regs.a);
  regs.hl = 0x639e;
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl))); // dec (hl); Z decides the branch

  if (regs.fZ) {
    // ---- ADVANCE (tail 0x12CB): 0x639E reached 0 ----
    regs.hl = 0x694d;
    regs.a = 0xf4;
    regs.rl(mem.read8(regs.hl)); // rl (hl): carry = old bit7 (store dropped -- dead)
    regs.rra(); // A = 0xFA if old bit7 set, else 0x7A
    mem.write8(regs.hl, regs.a); // (0x694D) := 0x7A / 0xFA

    regs.hl = 0x639d;
    mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); // advance state 1 -> 2
    regs.a = 0x80;
    mem.write8(SUBSTATE_TIMER, regs.a); // reload SUBSTATE_TIMER = 128 ticks (0x80)

    m.ret(145); // ROM 0x12AF..0x12DD path total (collapsed; atomic)
    return;
  }

  // ---- BLINK: 0x639E still counting -> toggle (0x694D) bit0 + (0x694E) bit7 ----
  regs.hl = 0x694d;
  regs.a = mem.read8(regs.hl);
  regs.rra(); // value DEAD; carry-out = bit 0 of (0x694D)
  regs.a = 0x02;
  regs.rra(); // A = 0x81 if bit0 of (0x694D) was set, else 0x01
  regs.b = regs.a;
  regs.xor(mem.read8(regs.hl));
  mem.write8(regs.hl, regs.a); // (0x694D) ^= B
  regs.l = regs.inc8(regs.l); // inc l -- 8-bit (0x694D -> 0x694E)
  regs.a = regs.b;
  regs.and(0x80);
  regs.xor(mem.read8(regs.hl));
  mem.write8(regs.hl, regs.a); // (0x694E) ^= (B & 0x80)

  m.ret(140); // ROM 0x12AF..0x12CA path total (collapsed; atomic)
}

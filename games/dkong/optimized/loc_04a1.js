// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_04a1 — hand-optimized rewrite of the translated routine at ROM 0x04a1,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its single tail callee (0x04a3 loc_04a3) is reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so it
 * resolves to the oracle or to a future optimized rewrite — never a copy.
 * No RAM names are imported: the routine touches only a register.
 */

/**
 * loc_04a1 -- the "low colour code = 0x10" preset arm of the colour-tail redraw.
 * [ROM 0x04a1-0x04a2, then falls into loc_04a3 @ 0x04a3]
 *
 *   04a1  3e 10   ld  a,0x10   ; A = base colour code 0x10
 *   04a3          (falls into loc_04a3, the colour-column fill)
 *
 * WHAT IT DOES. This is one of the two ways loc_0486 (the shared colour-cycle
 * tail) enters the colour-column fill at loc_04a3. loc_0486 loads C from the
 * animation frame counter (0x6390) and routes:
 *   - counter == 0            (`jp z,0x04a1`)        -> here (A := 0x10)
 *   - counter != 0, bit6 == 0 (falls through 0x049e) -> here (A := 0x10)
 *   - counter != 0, bit6 == 1 (`jp nz,0x04a3`)       -> loc_04a3 with A = 0xef
 * So loc_04a1 supplies the DIM colour code (0x10) that loc_04a3 hands to
 * sub_0514, which fills it DOWN a 3-cell VRAM colour column from 0x75C4 (0x75C4
 * := 0x10, then 0x0F, 0x0E at stride 0x20). The bit-6-set case uses 0xEF (bright)
 * instead and skips this preset. So loc_04a1 is a pure register preset: it sets
 * the colour value for the "counter low half" phase of the flashing colour cycle.
 *
 * INPUTS:  none — A is loaded with a constant; no RAM/register is read.
 * OUTPUTS: register A = 0x10 (consumed by loc_04a3's sub_0514 call as the fill
 *          value; observable as VRAM 0x75C4 = 0x10). No RAM write of its own, and
 *          NO hardware-register write — so no bus-cycle-positioned write and no
 *          write-trace concern.
 *
 * FLAGS. `ld a,n` sets no Z80 flags, so F is UNTOUCHED here. The caller's F
 * (loc_0486's `and a` Z on the counter==0 path, or its `bit 6,c` Z on the
 * fall-through path) passes straight through and is overwritten by sub_0514's
 * arithmetic (in the loc_04a3 tail) before anything reads it. We therefore leave
 * F alone exactly as the oracle does, and A + F match the oracle bit-for-bit.
 *
 * CYCLES -- PER-INSTRUCTION (a single 7t charge; nothing to collapse). loc_04a1
 * is a LEAF reached only via `m.call` from loc_0486, which sits on the
 * INTERRUPTIBLE main-loop cascade (loc_197a -> entry_03fb -> loc_0413 -> loc_0486,
 * NMI mask ENABLED). By the atomicity-is-per-call-path rule it is NOT atomic: the
 * vblank NMI can land inside, so its cycle position is load-bearing. Being one
 * instruction, per-instruction and "one total per branch" are the SAME single
 * `m.step(0x04a3, 7)` — kept at the oracle's exact cumulative cycle.
 *
 * CALLING CONVENTION. loc_04a1 is entered by a JUMP (loc_0486's `jp z,0x04a1`
 * or fall-through), not a CALL, so it pushes NO return address; it tail-jumps to
 * loc_04a3 via `m.call(0x04a3)` with no `m.push16` (matching the oracle). The
 * eventual `ret` down in loc_04ac returns to loc_0486's own caller.
 */
export function loc_04a1(m) {
  const { regs } = m;

  // ld a,0x10 -- preset the dim colour code, then fall into the column fill.
  regs.a = 0x10;
  m.step(0x04a3, 7); // ld a,0x10 -- falls into 0x04a3
  return m.call(0x04a3);
}

// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0057 — hand-optimized rewrite of the translated routine at ROM 0x0057,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. sub_0057 makes no call of its own, so there is nothing to
 * route through `m.call` here; only the RAM names RANDOM / FRAME / SPIN_COUNT are
 * imported (from ram.js). `translated/` is never edited.
 */

import { RANDOM, FRAME, SPIN_COUNT } from "./ram.js";

/**
 * sub_0057 -- the PRNG accumulator, stirred once per vblank.  [ROM 0x0057-0x0065]
 *
 *   0057  3a 18 60   ld  a,(0x6018)   ; A  = RANDOM
 *   005a  21 1a 60   ld  hl,0x601a    ; HL = &FRAME
 *   005d  86         add a,(hl)       ; A += FRAME          (sets Z80 add flags)
 *   005e  21 19 60   ld  hl,0x6019    ; HL = &SPIN_COUNT
 *   0061  86         add a,(hl)       ; A += SPIN_COUNT     (sets Z80 add flags)
 *   0062  32 18 60   ld  (0x6018),a   ; RANDOM = A
 *   0065  c9         ret
 *
 * WHAT IT DOES. It computes the game's pseudo-random seed:
 *     RANDOM += FRAME + SPIN_COUNT   (8-bit, wrapping)
 * FRAME (0x601A) is DECREMENTED once per vblank by the NMI; SPIN_COUNT (0x6019)
 * is INCREMENTED ~140x/frame by the main-loop vblank-spin, jittering with the
 * frame's workload. Summing a smooth counter and a jittery one into RANDOM is
 * the entropy: it is read as randomness at ROM 0x2186 etc (barrel/enemy
 * behaviour). Measured 2576 changes over 2600 frames, full byte range.
 *
 * INPUTS  (RAM read): RANDOM, FRAME, SPIN_COUNT.
 * OUTPUTS (RAM written): RANDOM.
 * OUTPUTS (registers left): A = the new RANDOM byte; HL = 0x6019 (&SPIN_COUNT,
 *   the last address loaded); F = the flags of the SECOND `add` (the first add's
 *   flags are overwritten by the second and never observed). No callee.
 *
 * ─ THE ARITHMETIC AND TOTAL ARE LOAD-BEARING ─────────────────────────────────
 * The `add`s are kept verbatim (regs.add) so both the wrapping SUM and the Z80
 * add flags match the oracle bit-for-bit: a wrong sum reseeds the PRNG and
 * diverges gameplay, and F is part of the register file the unit gate compares.
 * The routine's TOTAL cycle cost (70t) is equally load-bearing -- it is one of
 * the per-frame charges whose sum sets how long the main loop then spins, which
 * IS SPIN_COUNT's entropy (README §2). It is preserved exactly.
 *
 * ─ LADDER STATUS -- named + documented, cycles KEPT PER-INSTRUCTION ───────────
 * NOT collapsed, and deliberately so. Atomicity is PER-CALL-PATH, and sub_0057
 * has SEVEN callers on TWO kinds of path (grep `m.call(0x0057)`):
 *   • entry_0066 @ ROM 0x00B9 -- the vblank NMI handler, which runs with the NMI
 *     mask CLEARED. Atomic here: no reentrant NMI can land inside sub_0057.
 *   • entry_2c41 (0x2C41), sub_2523 (0x2523 x2, the "second RNG draw"),
 *     loc_2ea7 (0x2EBD), sub_306f (0x308B) -- all in-game object/enemy logic run
 *     by the MAIN-LOOP task dispatcher, where the NMI mask is ENABLED. On these
 *     paths the vblank NMI CAN fire BETWEEN sub_0057's instructions.
 * So the routine is interruptible on five of its seven call sites. Were the
 * charges collapsed, a mid-routine NMI would (a) push a different PC and (b)
 * push the intermediate HL/A into the diffed stack RAM at a shifted moment --
 * the exact failure that reverted sub_0008/0010/0018 and keeps sub_0020/loc_197a
 * per-instruction. A whole-machine run that happens not to land an NMI inside it
 * is NOT proof of atomicity; when a leaf has any interruptible caller, keep
 * per-instruction -- which is always correct. So every `m.step` boundary
 * (0x005a/5d/5e/61/62/65) and its charge stays, so that whatever instant the NMI
 * lands, the pushed PC and the live HL/A are identical to the oracle's.
 *
 * The optimization here is therefore names + a documented contract, not a cycle
 * collapse: exactly handler_01c3's "named + documented, not de-scaffolded" rung.
 * The one behaviour-neutral tidy is dropping the oracle's `ld hl,0x601a` as a
 * SEPARATE step -- FRAME is read straight through HL, which the named constant
 * makes explicit -- but HL is still set to &FRAME at that boundary (its value is
 * observable to a mid-routine NMI) before being reloaded with &SPIN_COUNT.
 */
export function sub_0057(m) {
  const { regs, mem } = m;

  // A = RANDOM
  regs.a = mem.read8(RANDOM);
  m.step(0x005a, 13); // ld a,(0x6018)

  // HL = &FRAME, then A += FRAME. HL's value here is live to a mid-routine NMI,
  // so it is set even though FRAME is read straight through it.
  regs.hl = FRAME; // 0x601a
  m.step(0x005d, 10); // ld hl,0x601a
  regs.add(mem.read8(regs.hl));
  m.step(0x005e, 7); // add a,(hl)

  // HL = &SPIN_COUNT (the residual HL on return), then A += SPIN_COUNT. This
  // second add sets the flags the unit gate compares on return.
  regs.hl = SPIN_COUNT; // 0x6019
  m.step(0x0061, 10); // ld hl,0x6019
  regs.add(mem.read8(regs.hl));
  m.step(0x0062, 7); // add a,(hl)

  // RANDOM = A
  mem.write8(RANDOM, regs.a);
  m.step(0x0065, 13); // ld (0x6018),a

  m.ret(); // +10t; total 70t
}

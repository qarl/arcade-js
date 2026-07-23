// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_004e — hand-optimized rewrite of the translated routine at ROM 0x004E,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. It calls no ROM subroutine (the block copy is the Z80
 * `ldir` instruction, a machine primitive reached through m.ldirAt, not a callee),
 * so nothing is reached through `m.call` here. Only the RAM *name* SPRITE_OBJ_BLOCK
 * is imported (from ram.js).
 */

import { SPRITE_OBJ_BLOCK } from "./ram.js";

/**
 * sub_004e -- block-copy a 40-byte sprite-object template into SPRITE_OBJ_BLOCK.
 * [ROM 0x004E-0x0056]
 *
 *   004e  11 08 69     ld   de,0x6908       ; DE = SPRITE_OBJ_BLOCK (0x6908)
 *   0051  01 28 00     ld   bc,0x0028       ; BC = 0x28 = 40 bytes (10 records * 4)
 *   0054  ed b0        ldir                 ; copy (HL)->(DE), BC bytes
 *   0056  c9           ret
 *
 * A tiny, HEAVILY-SHARED leaf (17 call sites across state0.js + nmi.js): every
 * caller wanting to lay a fresh 10-record sprite-object group into the shadow
 * sprite buffer sets HL to its ROM template and calls here. The destination
 * (0x6908) and length (0x28) are hard-wired; only the SOURCE varies per caller.
 *
 * INPUTS
 *   HL  (register)  IMPLICIT INPUT -- the copy SOURCE. This routine never sets HL,
 *                   so the source address comes entirely from the caller (e.g.
 *                   loc_0abf supplies ROM 0x388C; loc_186f supplies ROM 0x3A1F).
 *                   The nine bytes here do NOT determine it.
 * OUTPUTS (RAM)
 *   0x6908-0x692F   the 40-byte destination (SPRITE_OBJ_BLOCK = SPRITE_BUFFER+8),
 *                   overwritten with the 40 source bytes.
 * OUTPUTS (registers, all left exactly where the ldir leaves them, visible to caller)
 *   HL = HL_in + 0x28   (source advanced past the copied block)
 *   DE = 0x6930         (0x6908 + 0x28, dest advanced past the block)
 *   BC = 0
 *   A, IX, IY          untouched
 *
 * FLAGS: NONE are set. `ld de` / `ld bc` do not touch F, and `ldir` in this
 * translation (machine.ldirAt) leaves F alone -- so F (carry included) passes
 * through from entry UNCHANGED, identically on both sides. The oracle docstring's
 * "PRESERVES CARRY" is exactly this pass-through; whichever caller consumes the
 * carry sees the same bit it had on entry on both paths. The unit gate compares
 * the whole register file, F included, and confirms it.
 *
 * ATOMICITY -- NOT ATOMIC ON EVERY CALL PATH, so KEPT PER-INSTRUCTION (README §2,
 * and the brief's per-call-path rule). Two independent reasons the cycle
 * distribution here is LOAD-BEARING and must not be collapsed:
 *
 *   1. INTERRUPTIBLE CALLERS. Of the 17 callers, at least one is a MAIN-LOOP task
 *      (loc_07cb, the per-frame countdown-animation task dispatched from the 0x0754
 *      task table -- NMI mask ENABLED). On that path the vblank NMI can fire between
 *      any two instructions of this routine, and the PC it pushes into diffed stack
 *      RAM must be the exact next address (0x0051 / 0x0054 / 0x0056). Collapsing the
 *      two `ld` charges into one would push 0x0054 where the oracle pushes 0x0051.
 *
 *   2. INTERRUPTIBLE LDIR. m.ldirAt is deliberately per-byte: it charges 21 t and
 *      calls m.step(0x0054, 21) for each of the first 39 bytes (16 t on the 40th),
 *      and each of those steps is an NMI-check point. That models the real Z80's
 *      interruptible LDIR -- a mid-copy NMI re-fetches the LDIR opcode, so the
 *      pushed PC is 0x0054 (the LDIR's own address), not 0x0056. A one-shot copy
 *      loop with a single lumped charge would erase those interior NMI-check points
 *      and push the wrong PC if the NMI ever lands inside the 835-t copy on a
 *      mask-enabled path. So m.ldirAt is retained VERBATIM.
 *
 * (Contrast sub_09fe, which DID collapse its ldir: it is reached ONLY from the NMI
 * dispatch, where the mask is cleared, so no nested NMI can ever land inside it.
 * sub_004e's main-loop callers make it a different case -- per the brief, "when ANY
 * caller is main-loop or interruptible, keep per-instruction; when unsure, keep
 * per-instruction -- it is always correct.") The routine is already minimal, so the
 * optimization win here is the name (SPRITE_OBJ_BLOCK) + the documented contract,
 * not fewer operations: correctness forbids de-scaffolding this particular leaf.
 */
export function sub_004e(m) {
  const { regs } = m;

  // ld de,0x6908 -- destination = SPRITE_OBJ_BLOCK (the 10-record sprite-object group).
  regs.de = SPRITE_OBJ_BLOCK;
  m.step(0x0051, 10);

  // ld bc,0x0028 -- copy length: 40 bytes = 10 records * 4 bytes each.
  regs.bc = 0x0028;
  m.step(0x0054, 10);

  // ldir -- copy 0x28 bytes (HL)->(DE). HL is the caller-supplied SOURCE (implicit
  // input; never set here). Kept per-byte via m.ldirAt so the copy stays INTERRUPTIBLE
  // (see the ATOMICITY note): a mid-copy NMI on a main-loop path pushes PC=0x0054, and
  // BC/DE/HL land at 0 / 0x6930 / HL_in+0x28 exactly as on hardware.
  m.ldirAt(0x0054, 0x0056);

  // ret -- unconditional, stack balanced, carry preserved. 10 t (per-instruction).
  m.ret();
}

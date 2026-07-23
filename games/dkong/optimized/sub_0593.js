// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0593 — hand-optimized rewrite of the translated routine at ROM 0x0593,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. It is a LEAF — it calls nothing — so there is no
 * `m.call` here, only the calling-convention scaffolding (`m.step`/`m.ret`).
 * No RAM names apply: every operand (A, IX, DE) is supplied live by the caller,
 * so there is nothing from ram.js to import.
 */

/**
 * sub_0593 -- the one-BCD-digit store shared by the vertical string/score
 * renderers.  [ROM 0x0593-0x059A]
 *
 *   0593  e6 0f        and  0x0f        ; A := low nibble (one BCD/hex digit 0..F)
 *   0595  dd 77 00     ld   (ix+0x00),a ; store the digit to the video cell IX points at
 *   0598  dd 19        add  ix,de       ; advance IX by the caller's signed step DE
 *   059a  c9           ret
 *
 * WHAT IT DOES. Masks A to a single digit, writes it to the tilemap cell
 * addressed by IX, then advances IX by DE so the caller can lay out the next
 * digit without recomputing an address. The caller owns direction and pitch:
 * loop_0583 and sub_0616 (mainloop.js) and sub_057c (state0.js) all pass
 * DE = 0xFFE0 (= -0x20, one tilemap row back — "up" in the unrotated tilemap),
 * and call it twice per source byte (high nibble then low). Position-agnostic
 * by design.
 *
 * INPUTS  : A  — raw byte, only the low nibble is kept.
 *           IX — destination video cell (observed 0x74xx-0x77xx VRAM).
 *           DE — signed step, caller-controlled (observed 0xFFE0).
 * OUTPUTS : (IX) := A&0x0F written to VRAM; IX := IX + DE; A := A&0x0F.
 *           F is set first by `and` (S,Z from result, H=1, P/V=parity, N=0, C=0)
 *           and then PARTLY OVERWRITTEN by `add ix,de` (H,N,C and the undocumented
 *           F3/F5 from the 16-bit result; S,Z,P/V survive from the `and`).
 *
 * FLAGS ARE LOAD-BEARING — kept verbatim. The oracle's own note (mainloop.js)
 * records that the carry out of `add ix,de` is NOT dead: on the caller's
 * fall-through path it survives past three `ret`s (0x059A -> 0x0592 -> 0x15B0,
 * still live past 0x15F9). Whether a reader ultimately consumes it is unresolved,
 * so the routine must set it EXACTLY. That is achieved for free by using the CPU
 * model's own `regs.and` and `regs.addIx` — the very methods the oracle calls —
 * so A, IX and the whole flag word match bit-for-bit and the unit gate (which
 * diffs the entire register file, F included) passes.
 *
 * ATOMICITY / CYCLES — PER-INSTRUCTION, NOT collapsed. This is a LEAF reached
 * only via m.call, so per the per-call-path rule its atomicity is decided by its
 * CALLERS, and ALL of them are MAIN-LOOP / interruptible (NMI mask ENABLED):
 *   - loop_0583 (mainloop.js) — the BCD render loop, reached from draw_0578 (the
 *     score/string renderer, main-loop dispatch) AND from sub_0616 <- entry_0611,
 *     a dispatchTask task whose own findings note sub_0616 is interruptible.
 *   - sub_057c (state0.js) — reached from sub_1486, the in-game 0x600A phase-21
 *     handler (also main-loop dispatch).
 * So the vblank NMI CAN land between these three instructions; the cumulative
 * cycle position of each is observable (a shifted charge would move where the NMI
 * lands and which PC it pushes into diffed stack RAM). The oracle's charges are
 * therefore kept one per instruction: and=7, ld (ix),a=19, add ix,de=15, ret=10.
 * (Harness-checked: a flat collapse of these into one charge PASSES a 240-frame
 * attract whole-machine run — but that is exactly the "the NMI didn't happen to
 * land in the window" trap, NOT proof of atomicity, so per-instruction stands as
 * the always-correct choice. See the accompanying equivalence test.)
 *
 * HARDWARE-WRITE NOTE: the store lands in tilemap/VRAM 0x74xx-0x77xx — inside the
 * diffed state dump, but NOT a 0x7Dxx hardware latch — and per-instruction cycles
 * already pin its bus position, so the value diff the state gate performs is
 * sufficient and no separate write-trace test is required.
 */
export function sub_0593(m) {
  const { regs, mem } = m;

  // and 0x0f -- keep one digit (sets S,Z,H=1,P/V; clears N,C).
  regs.and(0x0f);
  m.step(0x0595, 7);

  // ld (ix+0x00),a -- store the digit to the video cell IX addresses.
  mem.write8(regs.ix, regs.a);
  m.step(0x0598, 19);

  // add ix,de -- step to the next cell; sets H,N,C + F3/F5 from the 16-bit
  // result (the carry is live past this ret -- see the block comment).
  regs.addIx(regs.de);
  m.step(0x059a, 15);

  m.ret();
}

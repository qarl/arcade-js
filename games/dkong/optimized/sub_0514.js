// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0514 — hand-optimized rewrite of the translated routine at ROM 0x0514,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. sub_0514 is a LEAF — it calls nothing — so there is no
 * `m.call` here and nothing to import from ram.js: the routine touches no
 * absolute address, only the live-in registers HL/A/DE. (It writes wherever HL
 * points; its callers hand it a colour-RAM column address.)
 */

/**
 * sub_0514 -- colour-column fill primitive: store A into 3 colour-RAM cells,
 * descending, stride DE.  [ROM 0x0514-0x051B]
 *
 *   0514  06 03     ld  b,0x03     ; PROLOGUE (runs once): loop count = 3
 *   0516  77        ld  (hl),a     ; loc_0516 -- the djnz target
 *   0517  19        add hl,de      ; step to the next cell (DE = 0x20 stride)
 *   0518  3d        dec a          ; next colour value (descending)
 *   0519  10 fb     djnz 0x0516    ; loop 3x
 *   051b  c9        ret
 *
 * WHAT IT DOES. A tiny fixed-count fill used by the ATTRACT / intro colour-cycle
 * driver (entry_03fb) and by sub_1708 to paint one three-cell "column" of the
 * character/colour RAM. It writes the byte in A to (HL), advances HL by the
 * stride in DE, decrements A, and repeats exactly THREE times. B is hard-loaded
 * to 3 at entry, so the loop count is INVARIANT — there is no data-dependent
 * branch and no "loop 0/1/many" case: it always runs 3 passes. On the live
 * board-1 cascade its only caller is loc_04a3 (HL=0x75C4, A=0x10, DE=0x20), so
 * the three cells written are 0x75C4/0x75E4/0x7604 with 0x10/0x0F/0x0E.
 *
 * INPUTS  (all live-in): HL = first cell address, A = first colour byte,
 *         DE = stride (0x0020 in every observed call).
 * OUTPUTS: three bytes of colour RAM at HL, HL+DE, HL+2*DE set to A, A-1, A-2;
 *         HL advanced by 3*DE; A decremented by 3; B = 0; DE unchanged.
 *
 * TARGET RAM. The writes land in the character/colour RAM window (0x74xx-0x77xx),
 * ordinary video/work RAM whose VALUE is what matters — NOT a 0x7Dxx hardware
 * latch. So there is no bus-cycle / write-order concern and no `--writes` trace
 * to preserve: the RAM+register unit gate sees everything this routine does.
 *
 * FLAGS reaching the caller: S/Z/H/PV/N from the final `dec a`, C from the final
 * `add hl,de` (djnz and ret are flag-neutral). No live caller actually CONSUMES
 * them — loc_04a3, loc_04be and loc_04f1 each overwrite F with an `ld`/`bit`
 * before their next conditional — but the unit gate compares the whole register
 * file including F, so they are reproduced EXACTLY by using the same `addHl` /
 * `dec8` register helpers the oracle does (an idiomatic re-derivation of the
 * Z80 half-carry / parity would be a needless risk here).
 *
 * LADDER STATUS -- rung 4 (idiomatic), cycles KEPT PER-INSTRUCTION (byte-identical
 * to ../translated/state0.js). sub_0514 is NON-ATOMIC: by the ATOMICITY-IS-PER-
 * CALL-PATH rule a leaf is atomic only if the vblank NMI cannot fire inside it on
 * ANY call path, and every `m.call(0x0514)` site is reached from the INTERRUPTIBLE
 * per-frame cascade (loc_04a3/loc_04be/loc_04f1 <- loc_0486 <- entry_03fb <-
 * loc_197a, and sub_1708/0x17cd), all with the NMI mask ENABLED. So the NMI can
 * land between these instructions and its pushed PC reaches the diffed stack RAM
 * — the internal cycle DISTRIBUTION is observable and must not be collapsed.
 * Keeping the per-instruction m.step charges is the always-correct choice and
 * matches the same decision on its parents loc_04a3 / entry_03fb / loc_197a.
 * (The TOTAL is preserved trivially because the distribution is preserved.)
 */
export function sub_0514(m) {
  const { regs, mem } = m;

  // ld b,0x03 -- loop count (PROLOGUE, runs once, outside the loop body).
  regs.b = 0x03;
  m.step(0x0516, 7);

  // loc_0516 (the djnz target): fill 3 cells descending. `add hl,de` leaves C and
  // `dec a` leaves S/Z/H/PV/N live at the ret; djnz decrements B without touching F.
  do {
    mem.write8(regs.hl, regs.a);        m.step(0x0517, 7);  // ld (hl),a
    regs.addHl(regs.de);                m.step(0x0518, 11); // add hl,de
    regs.a = regs.dec8(regs.a);         m.step(0x0519, 4);  // dec a
    const looping = regs.djnz() !== 0;                      // djnz 0x0516 (flag-neutral)
    m.step(looping ? 0x0516 : 0x051b, looping ? 13 : 8);
  } while (regs.b !== 0);

  m.ret(); // 051b ret
}

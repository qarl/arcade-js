// SPDX-License-Identifier: GPL-3.0-only
/**
 * loop_0583 — hand-optimized rewrite of the translated routine at ROM 0x0583,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x0593, the single-digit renderer) is
 * reached through `m.call`, the routine registry (games/dkong/routines.js), so it
 * resolves to the oracle or to a future optimized rewrite — never a copy. Nothing
 * is imported from ram.js: this routine addresses VRAM and the score buffer only
 * through register pointers (HL/IX) that its two callers set up, so it has no
 * fixed work-RAM operand to name. The digit-renderer's ROM address is given a
 * local name for readability.
 */

// sub_0593: masks A to one BCD nibble, stores it at (IX), then advances IX by DE.
// A ROM entry point reached by address, NOT a work-RAM cell — so it is a local
// const here, not a ram.js name.
const RENDER_DIGIT = 0x0593;

/**
 * loop_0583 -- expand a run of packed-BCD bytes into on-screen digits.
 * [ROM 0x0583-0x0592]  A shared loop with THREE entry points into the same code:
 *   - draw_0578 (0x0578) falls in after `ld ix,0x7641 / ex de,hl / ld de,-32 /
 *     ld bc,0x0304` — render a 3-byte score (B = 3 bytes).
 *   - draw_056b (0x056b) reaches it through draw_0578 with a different IX column.
 *   - sub_0616 (0x0616) TAIL-JUMPS here (`jp 0x0583`) with its own HL/DE/IX and
 *     B = 1 — expand the single credits byte at 0x6001. A tail jump, so this
 *     routine's `ret` returns to sub_0616's caller, not to sub_0616.
 * Because those callers share no prologue, the loop is factored into its own
 * routine (the oracle's note) rather than gated behind another entry flag.
 *
 * WHAT IT DOES. For each of B source bytes, walking HL DOWNWARD:
 *   1. read (HL), rotate it right four times — a NIBBLE SWAP, not a shift: the
 *      four `rrca`s move the HIGH nibble into the low nibble (sub_0593 then masks
 *      0x0F), so the HIGH digit is emitted first;
 *   2. RENDER_DIGIT (0x0593) stores that nibble at (IX) and steps IX by DE;
 *   3. re-read (HL) unrotated and render again — the LOW digit;
 *   4. dec HL, `djnz` back for the next source byte.
 * Two digits per byte, high first, high source byte last: HL descending against
 * IX stepping by DE (its callers pass DE = -32, one tilemap row) is what turns
 * little-endian source order into top-to-bottom display order in the rotated
 * tilemap.
 *
 * INPUTS  : B = source-byte count (loop trips); HL = address of the HIGH source
 *           byte (walked down); IX = first VRAM cell; DE = per-digit VRAM step
 *           (callers pass 0xFFE0 = -32). Reads (HL) twice per byte.
 * OUTPUTS : 2*B digit cells written by RENDER_DIGIT via (IX), IX advanced by DE
 *           each. At exit HL = HL_in - B, B = 0, and A / IX / F are whatever the
 *           final RENDER_DIGIT left (A = last low nibble, IX = past the last cell,
 *           F from sub_0593's `add ix,de`). The unit gate compares the whole
 *           register file, F included, so every one of those is preserved.
 *
 * FLAGS. Nothing this routine computes is read by anything it hands control to:
 *   - each `rrca`'s flags are immediately overwritten by RENDER_DIGIT's `and 0x0f`;
 *   - `dec hl` is the 16-bit form (modelled as a masked subtract) and sets no flags;
 *   - `djnz` sets no flags on the Z80.
 * So the observable F at exit comes entirely from the last RENDER_DIGIT call,
 * which runs through m.call to the oracle (or its own rewrite) — identical either
 * way. The `rrca`s are kept as four real operations regardless, both to preserve
 * A entering the renderer and because the per-instruction cycle decision below
 * forbids folding them into one value.
 *
 * LADDER STATUS -- rung 5 (idiomatic), cycles KEPT PER-INSTRUCTION. loop_0583 is
 * NOT ATOMIC, so its m.step charges are NOT collapsed (README §2; the brief's
 * "when unsure, keep per-instruction — it is always correct"). Two independent
 * reasons, one per call path (atomicity is per-call-path):
 *   (a) sub_0616 tail-jumps here on the SAME frame-6 chain whose earlier link,
 *       handler_05e9, is documented to be INTERRUPTED by the vblank NMI mid-loop
 *       (handler_05e9.js: it pushes PC 0x060d onto diffed work RAM). loop_0583 is
 *       reached from that interruptible cascade — a "reached via a tail" NOT-atomic
 *       path in the brief's own words.
 *   (b) draw_0578/draw_056b reach it as an in-game main-loop TASK (handler_05c6,
 *       mask ENABLED), and the loop is data-dependent: `djnz` entered with B = 0
 *       runs 256 trips (~14k cycles, most of a frame), long enough for the NMI to
 *       land INSIDE it. A collapse that happens to survive the short attract run
 *       is not proof the NMI never lands on some trajectory.
 * Harness evidence (see the test): per-instruction reads EQUAL whole-machine AND
 * unit across B = 1 (loop-once, credits) and B = 3 (loop-many, score) — the two
 * counts the natural run produces — plus synthesised B = 2 and the B = 0 → 256
 * djnz-wrap edge. Since the distribution is retained, each branch's TOTAL is
 * retained trivially (B=1 190t, B=2 375t, B=3 560t; +185t per extra trip).
 */
export function loop_0583(m) {
  const { regs, mem } = m;

  do {
    // High digit: read the source byte and rotate its high nibble down.
    regs.a = mem.read8(regs.hl);
    m.step(0x0584, 7); // ld a,(hl)
    for (const nxt of [0x0585, 0x0586, 0x0587, 0x0588]) {
      regs.rrca(); // four rotates = swap nibbles; high nibble ends up low
      m.step(nxt, 4);
    }
    m.push16(0x058b);
    m.step(RENDER_DIGIT, 17); // call 0x0593 -- store the HIGH nibble at (IX)
    m.call(RENDER_DIGIT);

    // Low digit: re-read the same source byte, unrotated.
    regs.a = mem.read8(regs.hl);
    m.step(0x058c, 7); // ld a,(hl)
    m.push16(0x058f);
    m.step(RENDER_DIGIT, 17); // call 0x0593 -- store the LOW nibble at (IX)
    m.call(RENDER_DIGIT);

    // Next source byte is one address LOWER; loop for all B bytes.
    regs.hl = (regs.hl - 1) & 0xffff;
    m.step(0x0590, 6); // dec hl (16-bit: no flags)
    regs.djnz();
    m.step(regs.b !== 0 ? 0x0583 : 0x0592, regs.b !== 0 ? 13 : 8); // djnz 0x0583
  } while (regs.b !== 0);

  m.ret(); // 0592: ret -- to the ROUTINE's caller (sub_0616's caller on the tail path)
}

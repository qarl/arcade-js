// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_11d3 — hand-optimized rewrite of the translated routine at ROM 0x11D3,
 * proven equal to its oracle by the equivalence harness. A generic permuting gather; it
 * names no work RAM (operands are the caller's HL/IX/DE/B).
 */

/**
 * sub_11d3 -- permuting gather from an IX record into four consecutive bytes. [ROM 0x11D3-0x11EB]
 *
 * Five call sites (0x1046, 0x10DB, 0x117A, 0x119E, 0x11CF), all in the per-board setups.
 * Inputs, all caller-supplied: B = pass count, HL = destination, IX = source record base,
 * DE = the IX stride. Each pass gathers four source fields at IX+3, IX+7, IX+8, IX+5 -- IN
 * THAT ORDER (+5 read after +7/+8; +4 and +6 never read) -- into four consecutive
 * destination bytes (HL, `inc l` so H's page is fixed), then advances IX by DE and repeats.
 * A block copy over +3..+6 would look reasonable and be wrong.
 *
 * The djnz targets the routine ENTRY: the first instruction is also the first of the loop,
 * so there is no setup to hoist. `add ix,de` (NOT a 16-bit inc) writes H/N/C; that carry
 * escapes through the `ret`.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Reached from the board setups, whose atomicity
 * is not pinned to the mask-cleared NMI, so charges are kept verbatim.
 */
export function sub_11d3(m) {
  const { regs, mem } = m;

  do {
    // loop body -- the djnz at 0x11E9 lands on the routine entry. Offsets +3,+7,+8,+5.
    for (const [disp, afterLoad, afterInc] of [
      [0x03, 0x11d6, 0x11d8],
      [0x07, 0x11db, 0x11dd],
      [0x08, 0x11e0, 0x11e2],
      [0x05, 0x11e5, 0x11e7],
    ]) {
      regs.a = mem.read8((regs.ix + disp) & 0xffff);
      m.step(afterLoad, 19); // ld a,(ix+d)
      mem.write8(regs.hl, regs.a);
      m.step(afterLoad + 1, 7); // ld (hl),a
      regs.l = regs.inc8(regs.l); // `inc l` -- H untouched, wraps in page
      m.step(afterInc, 4); // inc l
    }

    regs.addIx(regs.de); // add ix,de -- writes H, N, C; carry escapes via the ret
    m.step(0x11e9, 15);

    regs.djnz();
    m.step(regs.b !== 0 ? 0x11d3 : 0x11eb, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret(); // 0x11EB
}

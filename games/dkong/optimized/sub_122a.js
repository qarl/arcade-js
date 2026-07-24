// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_122a — hand-optimized rewrite of the translated routine at ROM 0x122A,
 * proven equal to its oracle by the equivalence harness. A generic strided block-fill;
 * it names no work RAM (its operands are the caller's HL/DE/BC).
 */

/**
 * sub_122a -- strided block copy: B passes of 4 bytes, stride C+4.  [ROM 0x122A-0x123B]
 *
 * A sprite/shadow-table filler used across the per-board setups (loc_0fd7, 0x101F, 0x1131,
 * 0x1186). Each outer pass copies 4 source bytes (HL) into the destination (DE, `inc e` so
 * D's page is fixed), then advances E by C (the stride) + the 4 just written, and repeats B
 * times. B is the pass count, C the stride; the inner count is always 4 (never 0).
 *
 * THE REGISTER CONTRACT (three callers depend on it from outside and none can see it):
 *   - HL PRESERVED actively -- `push hl`/`pop hl` bracket the inner loop, discarding its
 *     four `inc hl`.
 *   - C  PRESERVED actively -- restored by `pop bc`. This is load-bearing: three routines
 *     set C via `ld bc,nn`, call here, then reload B ONLY before a `call 0x11d3` that
 *     consumes C -- satisfied solely by this `pop bc`.
 *   - B  CLOBBERED (0 at the ret); DE: D untouched, E advanced by B0*(C+4) mod 256;
 *     A  CLOBBERED (exits == E, never read before written); IX/IY passed through untouched
 *     (no DD/FD prefix). The carry out of the final `add a,c` escapes through the `ret`.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Reached from the board setups, whose atomicity
 * is not pinned to the mask-cleared NMI, so charges are kept verbatim. The push/pop that
 * preserve HL and C are modelled explicitly (m.push16/m.pop16) -- they are the contract.
 */
export function sub_122a(m) {
  const { regs, mem } = m;

  do {
    // outer loop body -- the djnz at 0x1239 lands here.
    m.push16(regs.hl);
    m.step(0x122b, 11);
    m.push16(regs.bc);
    m.step(0x122c, 11);
    regs.b = 0x04; // inner count, always 4, never 0
    m.step(0x122e, 7);

    do {
      regs.a = mem.read8(regs.hl);
      m.step(0x122f, 7);
      mem.write8(regs.de, regs.a);
      m.step(0x1230, 7);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x1231, 6);
      regs.e = regs.inc8(regs.e); // `inc e`, NOT `inc de` -- D untouched
      m.step(0x1232, 4);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x122e : 0x1234, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);

    regs.bc = m.pop16(); // restores the OUTER counter B *and* the stride C
    m.step(0x1235, 10);
    regs.hl = m.pop16(); // discards the inner loop's four `inc hl`
    m.step(0x1236, 10);

    regs.a = regs.e;
    m.step(0x1237, 4);
    regs.add(regs.c); // A = E + stride; carry escapes via the ret
    m.step(0x1238, 4);
    regs.e = regs.a;
    m.step(0x1239, 4);

    regs.djnz();
    m.step(regs.b !== 0 ? 0x122a : 0x123b, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  m.ret(); // 0x123B
}
